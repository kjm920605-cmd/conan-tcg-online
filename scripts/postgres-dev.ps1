[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'status')]
    [string]$Action = 'status',

    [ValidateRange(1, 65535)]
    [int]$Port = 55432
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$postgresRoot = Join-Path $workspaceRoot 'tmp\postgres-18.6'
$aliasDrive = 'P:'
$binaryRoot = "$aliasDrive\pgsql\pgsql"
$binDir = "$binaryRoot\bin"
$dataDir = "$aliasDrive\data"
$logPath = Join-Path $postgresRoot 'postgres.log'
$pgCtl = "$binDir\pg_ctl.exe"
$initDb = "$binDir\initdb.exe"
$psql = "$binDir\psql.exe"
$createdb = "$binDir\createdb.exe"
$pgIsReady = "$binDir\pg_isready.exe"

function Ensure-PostgresAlias {
    $mapping = (& subst $aliasDrive 2>$null) -join ''
    if ($LASTEXITCODE -eq 0 -and $mapping) {
        $mappedTarget = ($mapping -split '=>', 2)[1].Trim().TrimEnd('\')
        if (-not $mappedTarget.Equals($postgresRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "$aliasDrive is already mapped to '$mappedTarget'; PostgreSQL needs it for '$postgresRoot'"
        }
        return
    }
    & subst $aliasDrive $postgresRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to map $aliasDrive to the workspace-local PostgreSQL directory"
    }
}

function Remove-PostgresAlias {
    $mapping = (& subst $aliasDrive 2>$null) -join ''
    if ($LASTEXITCODE -eq 0 -and $mapping) {
        $mappedTarget = ($mapping -split '=>', 2)[1].Trim().TrimEnd('\')
        if ($mappedTarget.Equals($postgresRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
            & subst $aliasDrive /D
        }
    }
}

Ensure-PostgresAlias

foreach ($executable in @($pgCtl, $initDb, $psql, $createdb, $pgIsReady)) {
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "PostgreSQL executable not found: $executable"
    }
}

function Test-PostgresRunning {
    if (-not (Test-Path -LiteralPath $dataDir -PathType Container)) {
        return $false
    }
    & $pgCtl status -D $dataDir *> $null
    return $LASTEXITCODE -eq 0
}

function Initialize-PostgresData {
    if (Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION') -PathType Leaf) {
        return
    }
    if (Test-Path -LiteralPath $dataDir) {
        $existing = Get-ChildItem -LiteralPath $dataDir -Force
        if ($existing.Count -gt 0) {
            throw "Refusing to initialize non-empty data directory: $dataDir"
        }
    } else {
        New-Item -ItemType Directory -Path $dataDir | Out-Null
    }

    & $initDb -D $dataDir -U postgres --encoding=UTF8 --locale=C --auth-local=trust --auth-host=trust
    if ($LASTEXITCODE -ne 0) {
        throw "initdb failed with exit code $LASTEXITCODE"
    }
}

function Ensure-Database([string]$Name) {
    [string]$exists = & $psql -X -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$Name'"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed checking for database '$Name'"
    }
    if ($exists -ne '1') {
        & $createdb -h 127.0.0.1 -p $Port -U postgres --encoding=UTF8 $Name
        if ($LASTEXITCODE -ne 0) {
            throw "Failed creating database '$Name'"
        }
    }
}

switch ($Action) {
    'start' {
        Initialize-PostgresData
        if (-not (Test-PostgresRunning)) {
            $postgresProcess = Start-Process -FilePath "$binDir\postgres.exe" -ArgumentList @('-D', $dataDir, '-h', '127.0.0.1', '-p', $Port) -WorkingDirectory $binDir -WindowStyle Hidden -RedirectStandardOutput "$aliasDrive\postgres-stdout.log" -RedirectStandardError "$aliasDrive\postgres.log" -PassThru
            $ready = $false
            for ($attempt = 0; $attempt -lt 100; $attempt++) {
                if ($postgresProcess.HasExited) {
                    break
                }
                & $pgIsReady -h 127.0.0.1 -p $Port -U postgres -d postgres *> $null
                if ($LASTEXITCODE -eq 0) {
                    $ready = $true
                    break
                }
                Start-Sleep -Milliseconds 200
            }
            if (-not $ready) {
                throw "PostgreSQL failed to start; inspect $logPath"
            }
        }
        Ensure-Database 'conan_tcg_dev'
        Ensure-Database 'conan_tcg_test'
        Write-Output "PostgreSQL is running on 127.0.0.1:$Port"
        Write-Output "DATABASE_URL=postgresql://postgres@127.0.0.1:$Port/conan_tcg_dev"
        Write-Output "TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:$Port/conan_tcg_test"
    }
    'stop' {
        if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION') -PathType Leaf)) {
            Write-Output 'PostgreSQL data directory is not initialized.'
        } elseif (Test-PostgresRunning) {
            & $pgCtl stop -D $dataDir -m fast -w
            if ($LASTEXITCODE -ne 0) {
                throw "PostgreSQL failed to stop (exit code $LASTEXITCODE)"
            }
            Write-Output 'PostgreSQL stopped.'
        } else {
            Write-Output 'PostgreSQL is already stopped.'
        }
        Remove-PostgresAlias
    }
    'status' {
        if ((Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION') -PathType Leaf) -and (Test-PostgresRunning)) {
            & $psql -X -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc 'SELECT version()'
            if ($LASTEXITCODE -ne 0) {
                throw "PostgreSQL process exists but is not accepting connections on 127.0.0.1:$Port"
            }
        } else {
            Write-Output 'PostgreSQL is stopped or not initialized.'
            exit 3
        }
    }
}
