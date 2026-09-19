# Detective Conan Trading Card Game — Digital Rules Reference

> Source: Official Rule Manual Ver.2.5 (27 pages)
> Purpose: Codex / game-engine implementation reference
> Language policy: retain official Japanese terms as canonical names; Traditional Chinese is explanatory.
> Scope: summarizes the official rule manual only. It does not invent card-specific rules that are not present in the manual.

---

## 0. Document Rules for Implementation

### 0.1 Canonical terminology

When implementing code, preserve the following official terms in comments, rule IDs, or documentation where useful:

- パートナー = Partner
- キャラ = Character
- イベント = Event
- 事件 = Case
- 現場 = Field
- 証拠 = Evidence
- FILEエリア = FILE Area
- リムーブエリア = Remove Area
- 手札 = Hand
- 推理 = Deduction
- アクション = Action
- ガード = Guard
- コンタクト = Contact
- アシスト = Assist
- 事件解決 = Case Resolution
- 宣言 = Declare ability
- カットイン = Cut-in
- 変装 = Disguise
- ヒラメキ = Inspiration
- リフレッシュ = Refresh
- 名乗り状態 = Newly-entered state

### 0.2 Source-of-truth rule

- The official Ver.2.5 PDF is the source of truth.
- This file is a structured summary for implementation.
- If this file and the PDF conflict, stop implementation and check the PDF.
- Do not infer card-specific effects from card names, art, rarity, or flavor text.
- Unknown behavior must be marked `RULE-QUESTION` rather than guessed.

---

# FILE.1 — Game Preparation

## 1. Card Types

The game uses four card types. [Official manual pp.3–5]

### 1.1 Partner Card — パートナーカード

Role:
- Represents the player's partner.
- Has LP (Logic Point).
- Partner abilities are shared/common according to the manual.
- Can perform `推理`.
- Has two key abilities: `アシスト` and `事件解決`.

Suggested data fields:

```ts
interface PartnerCardDefinition {
  id: string;
  cardNo: string;
  name: string;
  colors: Color[];
  rarity?: string;
  lp: number;
}
```

### 1.2 Character Card — キャラカード

Role:
- Enters the `現場`.
- Can perform `推理` and `アクション` when allowed.

Important printed attributes:
- Level
- Name
- Color
- Features / traits (`特徴`)
- AP (Action Point)
- LP (Logic Point)
- Ability text
- ID
- Card No.
- Rarity

Notes:
- Level determines whether the card can be used from hand based on FILE Area count.
- AP is used during Contact.
- LP determines Evidence gained by Deduction.
- Level/AP/LP may become negative. Negative values alone do **not** remove a Character.

### 1.3 Event Card — イベントカード

Role:
- One-shot card with an effect.
- Has Level and color restrictions when normally used from hand.
- After its effect resolves, it is normally placed in the Remove Area.

### 1.4 Case Card — 事件カード

Role:
- Represents the Case the player must solve.
- Has two states:
  - `事件編` — Case side
  - `解決編` — Resolution side
- Starts in `事件編`.
- Once moved to `解決編`, it never returns to `事件編` under the rules in this manual.

Important fields:
- Name
- ID
- Card No.
- Color / colors
- Ability
- Case Level for first player
- Case Level for second player

The relevant Case Level depends on whether the player is first or second.

---

## 2. Card State

Partner and Character state is represented physically by card orientation. [p.6]

```ts
type CardOrientationState =
  | "ACTIVE"
  | "SLEEP"
  | "STUN";
```

### 2.1 Active — アクティブ状態

- Upright.
- Normally the required state to begin Deduction, Action, Guard, or pay a Sleep cost.

### 2.2 Sleep — スリープ状態

- Sideways.
- A card becomes Sleep when performing actions such as Deduction, Action, Guard, or when paying a Sleep cost.

### 2.3 Stun — スタン状態

- Upside down.
- Caused by a `スタンさせる` effect.
- If a Stunned Character would be made Active by the Auto Phase or an effect, it becomes Sleep instead.
- This replacement removes the Stun state.
- If a Stunned Character is told to Sleep or Stun again, it remains Stunned.

Implementation invariant:

```text
ACTIVE --sleep--> SLEEP
ACTIVE --stun--> STUN
SLEEP  --active--> ACTIVE
SLEEP  --stun--> STUN
STUN   --active--> SLEEP
STUN   --sleep--> STUN
STUN   --stun--> STUN
```

---

## 3. Deck Construction

Each player needs 42 cards total. [p.7]

- 1 Partner
- 1 Case
- exactly 40 cards in the main deck

Main deck rules:

1. Exactly 40 cards.
2. Only Character and Event cards are included in the main deck.
3. Partner and Case cards are not included in the main deck.
4. Maximum 3 copies of the same card ID.
5. Different artwork with the same ID counts as the same card.
6. There is no deck-building color restriction stated here; color restrictions are applied when cards are used during play.

```ts
interface DeckDefinition {
  partnerId: string;
  caseId: string;
  mainDeck: string[]; // exactly 40 IDs/instances
}
```

Validation:

```text
mainDeck.length === 40
countByCardId[id] <= 3
mainDeck contains only CHARACTER or EVENT
```

`RULE-QUESTION-001` — Events/tournaments may impose additional construction rules. These are explicitly outside the generic rule manual and require separate event regulations.

---

## 4. Game Zones

The manual defines eight main areas. [p.8]

### 4.1 Field — 現場

- Characters enter here.
- Maximum 5 Characters.
- Multiple copies of the same card may coexist.

### 4.2 Partner Area — パートナー

Contains:
- Partner
- MR cards when applicable
- Certain special cards specified by card text/features

### 4.3 Case Area — 事件

- Contains the player's Case card.

### 4.4 Deck — デッキ

- Main deck.
- Ordered and hidden unless an effect says otherwise.

### 4.5 Evidence Area — 証拠エリア

- Contains Evidence gained during play.
- Evidence cards retain order.
- Newest Evidence is placed on top.

### 4.6 FILE Area — FILEエリア

- Cards are added during Auto Phase.
- FILE Area has order.
- Newest card is placed on top.
- A Partner moved here by `アシスト` counts as one card while there.

### 4.7 Remove Area — リムーブエリア

Contains:
- Removed cards.
- Used Event cards after resolution, except timing-specific exceptions.

### 4.8 Hand — 手札

- Hidden from opponent.
- Cards are normally used from here.

### Zone invariants

- Field has a maximum of 5 Characters.
- Hand and areas other than Field have no general maximum in this manual.
- A player's cards do not enter or move to the opponent's zones.

Suggested engine enum:

```ts
type Zone =
  | "FIELD"
  | "PARTNER"
  | "CASE"
  | "DECK"
  | "EVIDENCE"
  | "FILE"
  | "REMOVE"
  | "HAND";
```

---

# FILE.2 — Game Flow

## 5. Game Setup

Official sequence. [p.9]

1. Place selected Case and Partner face down in their areas.
2. Shuffle the main deck and place it in the Deck area.
3. Determine first/second player randomly.
4. Each player draws 5 cards.
5. Each player may perform one mulligan:
   - choose any number of cards from hand;
   - return those cards to the deck;
   - shuffle;
   - draw the same number;
   - first player decides/performs first, then second player.
6. Turn Case and Partner face up.
7. First player's first turn begins.

Suggested setup state:

```ts
interface MatchSetupState {
  firstPlayerId: PlayerId;
  mulliganCompleted: Record<PlayerId, boolean>;
  gameStarted: boolean;
}
```

---

## 6. Win / Loss Conditions

### 6.1 Normal win — solve the Case

The player wins by successfully using Partner's `事件解決` ability when:

- their Case is already in `解決編`; and
- their Evidence count is at least the relevant Case Level.

Reaching enough Evidence alone does **not** automatically win; the Partner action must be performed.

### 6.2 Refresh loss

When a player must perform `リフレッシュ` and their Remove Area contains zero cards, that player loses. [p.9]

Suggested engine terminal reasons:

```ts
type MatchEndReason =
  | "CASE_SOLVED"
  | "REFRESH_WITH_EMPTY_REMOVE";
```

`RULE-QUESTION-002` — The manual does not define a general draw/tie resolution for simultaneous terminal outcomes. Do not invent one without comprehensive rules or official clarification.

---

## 7. Turn Structure

Each turn consists of three phases. [p.10]

```ts
type Phase =
  | "AUTO"
  | "MAIN"
  | "END";
```

Order is fixed:

```text
AUTO -> MAIN -> END -> opponent's AUTO
```

---

## 8. Auto Phase — オートフェイズ

Perform in order. [p.10]

1. Make your Partner Active.
2. Make all Characters in your Field Active.
   - Stunned Characters become Sleep instead of Active.
3. Draw 1 card.
   - First player also draws on turn 1.
4. Move cards from the top of Deck to FILE Area, face down, one at a time:
   - normally 2 cards;
   - first player's first turn: only 1 card.
5. If Partner had been in FILE Area due to Assist, return it to Partner Area and make it Active before/within the Auto handling specified by the manual.

FILE ordering:
- Each card is placed individually.
- Most recently placed is the top card.

Engine note:
- Steps must be represented individually because Refresh can interrupt card movement if Deck becomes empty.

---

## 9. Main Phase — メインフェイズ

The player may perform the following six action categories in any order and, except for explicit restrictions, any number of times. [p.11]

1. `手札の使用` — Use a card from hand
2. `ネクストヒント` — Next Hint
3. Partner ability
4. `宣言` ability
5. `推理` — Deduction
6. `アクション` — Action

General rule:
- Action numbers are categories, **not** required sequence.
- You cannot begin another action while an action is in progress or while an effect is resolving.
- Main actions do not freely interrupt one another.

This rule strongly suggests the engine should use a discrete action-resolution state rather than direct UI mutation.

---

## 10. Use a Card from Hand — 手札の使用

[p.11–12]

Restrictions:

- At most once per turn.
- Cannot be performed if the player has already performed `ネクストヒント` this turn.

Procedure:

1. Select one card in hand.
2. Its Level must be less than or equal to the current FILE Area card count.
   - Partner in FILE Area due to Assist counts toward this number.
3. The card must satisfy Case color restrictions.
4. Character:
   - enters Field in Active state.
5. Event:
   - resolve effect;
   - then move it to Remove Area, subject to effect-timing exceptions.

### 10.1 Color restriction

For normal Hand Use and Next Hint:

- A card must share the required color with the player's Case.
- A two-color card is treated as both colors.
- To use a two-color card, the player's Case must possess **both** colors.

Not subject to this normal Case-color restriction:
- Characters entering due to an effect.
- `カットイン`.
- `ヒラメキ`.

---

## 11. Next Hint — ネクストヒント

[p.12]

Purpose:
- Consume the top FILE resource to gain a card and receive an immediate opportunity to use one card.

Procedure is atomic:

1. Declare `ネクストヒント`.
2. Add the top card of FILE Area to hand.
   - Do not take the Partner if it is currently in FILE Area due to Assist.
3. After the removal, optionally use exactly one eligible card from hand.
4. The card's Level is checked against the **new** FILE count after step 2.
5. The card added in step 2 may itself be used.

Restrictions:

- Cannot be performed when FILE Area has no eligible card.
- Step 2 card use is optional.
- The right to use a card exists only inside this Next Hint resolution and cannot be saved for later.
- No other Main action may be inserted between the steps.

Important turn interaction:

```text
If NEXT_HINT used this turn:
  normal HAND_USE is no longer allowed.
```

The reverse means normal Hand Use occurring first does not prohibit Next Hint unless another rule/card does so; however, Next Hint's own immediate use remains governed by its rules.

---

## 12. Switch — スイッチ

[p.12]

Normally Field can hold at most 5 Characters.

When a Character would enter while Field is full, an existing Character may be removed to make room. This is `スイッチ`.

Rules:

- The removed Character has no Active/Sleep requirement.
- Switch is only allowed when:
  - Field is already full; or
  - multiple Characters are entering simultaneously and the Field limit would be exceeded.
- It is not a general-purpose voluntary remove action when there is free Field capacity.

Engine implication:
- Capacity resolution may require player choice before an entry event completes.

---

## 13. Partner Abilities

Partner has two shared abilities. Both require Partner to Sleep and therefore require it to be Active when used. [p.13]

### 13.1 Assist — アシスト

Purpose:
- Move Partner to FILE Area to increase FILE count.
- Also controls Case transition from `事件編` to `解決編`.

Procedure:

1. Declare Assist.
2. Sleep Partner.
3. Move Partner to FILE Area.
4. While there, Partner counts as a FILE Area card.
5. If FILE Area now contains 7 or more cards including Partner:
   - Case **must** transition to `解決編`.
   - This transition is mandatory if condition is met.

Once Case becomes `解決編`, it does not return to `事件編` under this manual.

### 13.2 Case Resolution — 事件解決

Requirements:

- Case must be in `解決編`.
- Partner must be Active so it can pay the Sleep cost.

Procedure:

1. Declare `事件解決`.
2. Sleep Partner.
3. Compare Evidence count with the player's relevant Case Level.
4. If Evidence >= Case Level, player wins.

---

## 14. Declare Ability — 宣言能力

[p.14]

A `宣言` ability may be used from:

- Character in your Field;
- your Case;
- MR in your Partner Area;
- another area if the ability itself explicitly specifies that area.

Procedure:

1. Declare the ability.
2. Pay **all** costs.
3. Resolve the effect.

Rules:

- Cannot interrupt another action or an effect currently resolving.
- A Character may use a Declare ability on the same turn it entered.
- A Character does not need to be Active unless its cost requires it.

### 14.1 Ability cost

A Declare ability with `:` has cost on the left side and effect on the right side.

All cost components must be payable; otherwise the ability cannot be used.

Cost interpretation:

- `自分の` may be omitted in cost text; opponent's cards cannot be used to pay your cost.
- If a cost says only `キャラ` without an area, it means a Character in your Field.
- A Sleep icon without another target means Sleep the Character using the ability itself.
- Similar targetless self-movement costs apply to the Character using the ability.
- Things performed as **costs** do not satisfy triggers worded like "when you did X by your ability/effect".

Engine model:

```ts
interface DeclaredAbility {
  sourceInstanceId: CardInstanceId;
  costs: Cost[];
  effect: Effect;
}
```

Cost payment should be committed before the effect is placed into resolution.

---

## 15. Deduction — 推理

[p.15]

Purpose:
- Gain Evidence based on LP.

Eligible source:

- Active Partner; or
- Active Character in your Field.

Newly entered Character restriction:

- A Character is in `名乗り状態` for the turn in which it entered.
- A Character in this state normally cannot Deduce.
- `迅速` removes this Deduction restriction.

Procedure:

1. Declare Deduction.
2. Sleep the Partner/Character performing it.
3. Opponent may perform `ミスリード` where legal.
4. Gain Evidence equal to the Deduction source's final LP for this Deduction.
5. Evidence is taken from top of your Deck and placed face down in Evidence Area one card at a time.
6. End Deduction.

Rules:

- First player may Deduce on turn 1.
- No per-turn count limit for a particular Partner/Character beyond needing to be Active each time.
- If it becomes Active again, it may Deduce again if otherwise eligible.
- If final LP <= 0, gain 0 Evidence.
- Evidence order matters; newest is top.
- Refresh may occur during multi-card Evidence gain.

---

## 16. Action — アクション

[p.16]

Purpose:
- Interact with opponent's Field Character or Case/Evidence.

Eligible source:
- Active Character in your Field.

Newly entered restriction:
- `名乗り状態` Characters normally cannot Action.
- `迅速` or applicable `突撃` variants may allow it.

Procedure start:

1. Choose one legal target.
2. Declare Action.
3. Sleep acting Character.
4. Opponent gets Guard opportunity.
5. Continue to Contact or Case-Action resolution.

Legal targets:

### 16.1 Action [Character]

Choose an opponent Character that is:
- Sleep; or
- Stun.

### 16.2 Action [Case]

Choose opponent's Case only if opponent has at least 1 Evidence.

### 16.3 Guard — ガード

Opponent may Guard with one Active Character in their Field.

- Guarding Character becomes Sleep.
- A Character in `名乗り状態` may Guard.
- No AP threshold is required to Guard.

If acting Character or originally targeted Character leaves Field before the Guard timing completes, the Action ends at that point as specified by the manual.

---

## 17. Contact — コンタクト

[p.17]

Contact occurs when:

1. Action [Character] is not Guarded:
   - acting Character contacts targeted Character.
2. Any Action is Guarded:
   - acting Character contacts Guarding Character.

### 17.1 Contact sequence

```text
CONTACT_START
-> DETERMINE_RESPONSE_ORDER
-> FIRST_PLAYER_CONTACT_RESPONSE
-> SECOND_PLAYER_CONTACT_RESPONSE
-> possible FIRST_PLAYER_SECOND_CHANCE
-> AP_CHECK
-> CONTACT_END
-> ACTION_END
```

### 17.2 Determine response order

Compare AP of the two Characters at Contact start/order determination:

- lower AP player's response is first;
- higher AP player's response is second;
- if AP equal, non-turn player / attacked side acts first.

Each player may:
- use one `カットイン`, or
- use one `変装`, or
- pass.

Each player may perform at most one Contact action/card per Contact.

Special pass rule:
- If first player in response order passes and second player acts, the first player gets another opportunity to act.

### 17.3 AP check

After Contact responses:

```text
if attacker.AP >= opposingCharacter.AP:
    remove opposingCharacter
else:
    no removal
```

Rules:

- Equal AP is sufficient for the attacker to remove the opposing Character.
- Acting/attacking Character is not removed merely because of this AP comparison.
- Contact-only modifiers such as Cut-in AP boosts expire at Contact end.
- If a Contact Character leaves Field during Contact, follow the manual's early progression/termination rule.
- A Contact created directly by an effect ends at the point specified by the manual and does not automatically imply the full parent Action lifecycle.

---

## 18. Contact Responses

[p.18]

### 18.1 Cut-in — カットイン

- Use a card from hand that has a Cut-in effect.
- Supports the Contact.
- Used card is placed in Remove Area according to Cut-in timing rules.
- Only one Cut-in card may be used by a player per Contact.
- If a card has multiple Cut-in effects, choose one.
- Cut-in ignores normal Case color restriction.

Example semantic form:

```text
Cut-in AP +2000
=> current Contact Character gets AP +2000 until Contact ends
```

### 18.2 Disguise — 変装

A Character card with `変装` may replace your Character currently in Contact.

Procedure/semantics:

1. Play Disguise Character from hand.
2. Replace current Contact Character with the Disguise Character.
3. Original Character is moved face down to bottom of Deck.
4. New Character is now the Character participating in Contact.

State inheritance:
- Sleep state is inherited.
- Effects granted by other cards are inherited.
- Cards set to it are inherited.
- Cards stacked underneath it are inherited.

Not inherited:
- Original printed identity information such as card name/color changes to the new card's identity.

Important:
- Disguise replacement is **not** treated as normal `登場`.
- Normal enter-the-Field triggers do not trigger from this replacement.
- `変装時` ability on the new Character does trigger.

---

## 19. Unguarded Action [Case]

[p.19]

If Action [Case] is not Guarded:

1. Remove the opponent's top Evidence card.
2. If that Evidence card has `ヒラメキ`, opponent may choose whether to activate it.
3. Resolve Inspiration if activated.
4. Then place that Evidence card into Remove Area after its Inspiration resolution / decline timing.
5. Acting player gains exactly 1 Evidence.
6. Resolve Action-end triggers.
7. Expire Action-duration effects.
8. End Action.

Rules:

- Removed Evidence = exactly 1, regardless of acting Character LP.
- Evidence gained = exactly 1, regardless of acting Character LP.
- `ヒラメキ` triggers only when Evidence is removed by Action [Case], not when Evidence is removed by an ability/effect through another cause.
- Face-up Evidence may still use Inspiration if removed by Action [Case].
- The Inspiration card is not yet in Remove Area while its Inspiration effect itself is resolving.

---

## 20. End Phase — エンドフェイズ

[p.10]

1. Trigger and resolve abilities that activate at end of turn.
2. Expire effects lasting "until end of turn".
3. End turn and pass to opponent.

---

# FILE.3 — Game Terms and Effect Semantics

## 21. Refresh — リフレッシュ

[p.20]

Refresh occurs **immediately** whenever your Deck becomes empty, including in the middle of an action or effect.

Procedure:

1. Shuffle all cards currently in your Remove Area and place them as your new Deck.
2. Opponent gains exactly 1 Evidence.
3. Resume the interrupted action/effect.

Loss condition:
- If Refresh is required and Remove Area has 0 cards, the refreshing player loses.

### 21.1 Cards not yet in Remove Area during effect resolution

The manual distinguishes timing:

- Event card and `ヒラメキ` card are **not yet** in Remove Area until their effect resolution finishes.
  - Therefore they are not included in a Refresh shuffle that occurs during that effect.
- `カットイン` and a `現場リムーブ時` trigger resolve while that card is already in Remove Area.
  - Therefore such cards can be included in a Refresh shuffle that occurs during their resolution.

### 21.2 Deck empties during iterative effects

For effects such as:
- draw cards;
- gain Evidence;
- put cards into FILE Area;
- set cards from top of Deck;

if Deck empties partway:

1. resolve as many as possible until empty;
2. Refresh immediately;
3. continue resolving the remaining quantity.

### 21.3 Insufficient Deck for conditions/costs

Different text has different behavior:

- If a condition/cost requires removing exactly N cards and there are not enough, the action/cost cannot be performed.
- "look at top N" / "reveal top N": do not Refresh merely because fewer than N exist; process as many as possible.
- "remove top N" as an effect: remove as many as possible, Refresh when Deck reaches zero, but do not continue removing the unmet remainder after Refresh unless the specific text says otherwise.

Engine requirement:
- Deck depletion cannot be handled only at phase boundaries. It must be an immediate state-based process during effect execution.

---

## 22. Abilities and Effects — 能力と効果

[p.21–22]

### 22.1 Ability categories

The manual broadly distinguishes:

#### A. Continuous ability

- Automatically active while the Character is in Field.
- If an ability explicitly names another area, it can be active there as specified.

#### B. Triggered ability

Contains a trigger condition such as:
- "when ..."
- "each time ..."
- timing icons such as `登場時`

When condition is satisfied, effect triggers.

Important:
- Triggered abilities are mandatory when their condition occurs, unless the text itself contains an optional clause.
- Usage-limit icons such as `ターン①` / `ターン②` limit frequency; within the allowed number, the player does not simply choose to suppress the trigger.
- If multiple copies of the same Character trigger simultaneously, all trigger; their controller may resolve their effects one at a time in chosen order.

#### C. Icon / keyword ability

Examples include:
- `登場時`
- `現場リムーブ時`
- `変装時`
- `疾風`
- `宣言`
- `カットイン`
- `変装`
- `ヒラメキ`
- keyword abilities

### 22.2 Ability/effect validity

Some text is valid only while icon conditions are satisfied.

If a required condition icon is not satisfied:

- continuous ability: effect stops applying;
- triggered ability: does not trigger;
- timing-icon trigger (enter/remove/disguise/etc.): does not trigger;
- Declare / Disguise: cannot be used if the rule says the ability itself is unusable;
- Cut-in: may be played in the allowed timing but has no effect if its effect text is invalid;
- Inspiration: may be activated but has no effect if invalid;
- Event: may be used but has no effect if its effect is invalid.

If an effect has already triggered and then its source ability becomes invalid before resolution, the already-triggered effect still resolves unless an explicit "negate/invalidate" effect says otherwise.

An invalid original ability may still count as an ability the card "has" when a rule specifically references the ability/icon itself, as described in the manual.

### 22.3 Mandatory vs optional effect text

- `～する` => mandatory; perform as much as possible if part cannot be performed.
- `～してもよい` => optional.
- `～枚まで` => may choose 0 unless otherwise specified.

If text says only `キャラ` with no area, it means Character in Field.

If effect says choose up to N Characters and does not restrict controller:
- may generally choose eligible Characters in either player's Field;
- may choose the source Character itself if eligible.

### 22.4 Pending effect queue

If an effect triggers during another action or effect:

- it becomes unresolved/pending;
- current action/effect finishes its current resolution point first;
- then pending effects can resolve.

Multiple pending effects controlled by one player:
- controller chooses their resolution order, regardless of trigger order.

Pending effects controlled by both players:

1. Turn player resolves their pending effects first.
2. When turn player has none remaining, non-turn player resolves theirs.

This is **not** a generic free-form stack/LIFO system.

Suggested model:

```ts
interface PendingEffect {
  controllerId: PlayerId;
  sourceInstanceId: CardInstanceId;
  effectId: string;
  triggeredAt: GameTiming;
}
```

### 22.5 Immediate replacement/negation exceptions

Effects worded as:
- "when X, instead ..."
- "when X, negate/invalidate ..."

resolve immediately at the relevant point rather than waiting in the ordinary pending queue.

`RULE-QUESTION-003` — The manual summary does not fully specify ordering if multiple replacement effects apply to exactly the same event. Require comprehensive rules or official Q&A before implementing arbitrary precedence.

---

## 23. Set Cards — カードのセット

[p.23]

Some effects set Event/cards onto a Character.

### 23.1 Set

- Set card remains attached to Character after effect resolves.
- No general limit on number of set cards attached to one Character.
- Face-down set card's front cannot be inspected.
- Face-down set card is not treated as Character or Event while set.
- When a face-down set card is removed, turn it face up and place it in Remove Area.

If host Character:
- leaves Field; or
- becomes stacked underneath another Character;

all cards set to it are removed.

### 23.2 Stack underneath — カードを下に重ねる

Different from Set.

- A card stacked underneath retains only count/quantity information unless another rule says otherwise.
- It is not treated as a Set card.
- If host Character leaves Field or is stacked under another Character, all cards underneath are removed.

Engine recommendation:

```ts
interface CharacterAttachmentState {
  setCards: CardInstanceId[];
  underCards: CardInstanceId[];
}
```

Do not merge these two concepts.

---

## 24. Icons

[p.24]

### 24.1 Timing / trigger icons

Canonical names and meanings:

- `登場時`
  - triggers when this Character enters Field;
  - also triggers when entered by an ability/effect.

- `現場リムーブ時`
  - triggers when this Character is removed from Field;
  - removal method does not matter unless another rule says otherwise.

- `変装時`
  - triggers when this Character appears in Field through `変装`.

- `疾風`
  - triggers when this Character is the first Character to enter your Field during that turn;
  - entry by effect can satisfy it;
  - entry on opponent's turn can satisfy it;
  - if 2+ Characters enter simultaneously and conditions are met, all qualifying triggers occur.

### 24.2 Validity-condition icons

- `自分ターン中`
  - valid during your turn.

- `相手ターン中`
  - valid during opponent's turn.

- `パートナー [color]`
  - your Partner must have specified color.

- `事件 [color/feature]`
  - your Case must possess specified color/feature.
  - if Case has multiple colors, possessing the specified one is enough.
  - if condition explicitly requires multiple colors with `&`, all are required.

- `FILE N`
  - your FILE Area contains at least N cards.
  - Partner in FILE Area due to Assist counts.

- `事件編`
  - your Case must be on Case side.

- `解決編`
  - your Case must be on Resolution side.

- `絆 [card name]`
  - a Character with specified card name must be in your Field.
  - Partner does not satisfy this condition.

### 24.3 Usage limit icons

- `ターン①`
  - once each turn.
  - for Declare ability, usable once each turn.

- `ターン②`
  - up to twice each turn.

Suggested representation:

```ts
interface AbilityValidity {
  ownerTurnOnly?: boolean;
  opponentTurnOnly?: boolean;
  partnerColors?: Color[];
  caseColors?: Color[];
  caseFeatures?: string[];
  minFileCount?: number;
  requiredCaseSide?: "CASE" | "RESOLUTION";
  requiredFieldCardName?: string;
}
```

---

## 25. Keyword Abilities

[p.25]

Keywords printed on the card are abilities.

Except for keywords temporarily granted by other effects, originally possessed / icon-enabled keyword abilities are treated as possessed even outside Field as described in the manual.

### 25.1 迅速 — Swift

- Character may perform Deduction or Action even while in `名乗り状態`.

### 25.2 突撃 — Charge

- Character may perform Action even while in `名乗り状態`.
- Does **not** grant Deduction.

### 25.3 突撃[キャラ]

- May perform Action [Character] while in `名乗り状態`.

### 25.4 突撃[事件]

- May perform Action [Case] while in `名乗り状態`.

### 25.5 ブレット — Bullet

- This Character's Action cannot be Guarded.

### 25.6 ミスリードX — Mislead X

When opponent performs Deduction:

- you may Sleep an Active Character in your Field that has Mislead;
- reduce the Deduction source's LP by X until the end of that Deduction.

Rules:
- Multiple Mislead Characters may be used simultaneously against one Deduction.
- LP reduction lasts only until that Deduction ends.

### 25.7 捜査X — Investigation X

Opponent:

1. reveals top X cards of their Deck, or as many as possible if fewer;
2. moves those revealed cards to bottom of Deck in opponent's chosen order;
3. those revealed cards are treated as `発見された` for the subsequent effect.

Opponent does not need to reveal the chosen bottom-deck ordering.

### 25.8 痕跡 — Trace

State belonging to player/game:

```ts
type TraceState = "UNDISCOVERED" | "DISCOVERED";
```

- Initially/while opponent has not Refreshed: `痕跡[未発見]`.
- When opponent Refreshes during this game: becomes `痕跡[発見済み]`.
- Once discovered, remains discovered for the rest of the game.
- Your own Refresh does not discover your Trace.

### 25.9 Newly-entered state Q&A

`名乗り状態` lasts for the entire turn in which the Character entered.

It restricts only:
- Deduction;
- Action.

It does not itself prohibit:
- Declare abilities;
- Guard;
- being removed by Switch;
- other actions not explicitly restricted.

If a `名乗り状態` Character gains `突撃`, it is allowed to Action during the Main Phase; it is not forced to Action immediately.

If it Actions using `突撃`, then later becomes Active again, it still remains in `名乗り状態` for that turn and still cannot Deduce unless it also has `迅速`.

---

## 26. MR

[p.26]

MR is a Character-card mechanic introduced in expansion 5.

Base behavior:

- MR is used like a normal card and enters Field as a Character.
- MR has two special MR rules/abilities.

### 26.1 MR uniqueness across Field/Partner Area

When an MR Character enters your Field:

- any MR already in your Field or Partner Area is removed.
- It does not matter whether it is the same card/name.
- Removing an existing Field MR this way counts as removal by ability/rule as described by the manual.

Engine invariant:

```text
At MR entry resolution:
  remove all existing own MR in FIELD/PARTNER area as required
  then maintain the newly entering MR
```

### 26.2 Leaving Field during opponent's turn

If your MR leaves Field during opponent's turn:

- it moves to Partner Area after first being placed in the destination area implied by the leaving event;
- this movement is not a replacement effect (`代わりに`).

Consequences:
- remove/leaving triggers still occur.
- manual says the method of leaving Field does not matter.

If MR leaves Field during **your own** turn:
- it does not move to Partner Area by this rule;
- it remains in / proceeds to the normal destination.

### 26.3 MR in Partner Area

MR in Partner Area:
- cannot Deduce;
- cannot Action;
- may use/trigger abilities that explicitly function in Partner Area, including applicable Declare abilities.

`RULE-QUESTION-004` — Exact MR card-specific abilities are not defined by the general rule manual and must come from card data.

---

## 27. Card Names Containing Multiple Character Names

[p.27]

For a card name containing 2+ Character names using the currently defined conventions such as `&` or parentheses:

Example concept:

```text
江戸川コナン＆工藤新一
```

The card is treated, in all areas, as having:

- its full composite card name; and
- each included Character name individually.

Therefore name-based conditions such as `絆` may recognize the component names.

Important selection rule:
- One physical card cannot be selected as multiple separate cards merely because it satisfies multiple names.

Implementation suggestion:

```ts
interface CardNameIdentity {
  printedName: string;
  recognizedNames: string[];
}
```

`RULE-QUESTION-005` — The manual states the currently covered naming conventions (`&`, parentheses). Future naming syntax should not be inferred automatically; maintain explicit card data for `recognizedNames`.

---

## 28. Special Effects

[p.27]

### 28.1 Set original LP/AP to 0

If effect makes original LP/AP 0:

- printed/base LP or AP becomes 0 for calculation;
- other plus/minus modifiers remain in effect;
- AP becoming 0 does not itself remove Character.

Recommended calculation:

```text
currentAP = overriddenBaseAP + modifiers
currentLP = overriddenBaseLP + modifiers
```

rather than resetting final modified value to zero.

### 28.2 Invalidate original abilities

If effect invalidates a Character's original abilities:

- abilities printed/originally on that Character become ineffective;
- abilities granted by other cards/effects are not invalidated by this wording;
- effects already triggered remain unresolved/resolvable as applicable;
- MR abilities are not invalidated by `元の能力を無効にする`;
- the Character can still be treated as "having" the original ability when a rule refers to possession, even though it is not currently effective.

Engine model should separate:

```ts
printedAbilities
runtimeGrantedAbilities
abilityValidity
pendingEffects
```

Do not delete ability definitions from the card instance when they become invalid.

---

# 29. Timing Model for the Digital Engine

This section is a structured implementation interpretation of the official rules, not additional game rules.

The manual does **not** describe a generic Magic-style stack. A safer model is:

```text
IDLE_MAIN
  -> ACTION_IN_PROGRESS
      -> current atomic step
      -> trigger collection
      -> immediate replacement/negation handling
      -> current action/effect reaches resolution point
      -> pending effect resolution
      -> next step
  -> IDLE_MAIN
```

Recommended timing primitives:

```ts
type GameTiming =
  | "TURN_START"
  | "AUTO_PARTNER_ACTIVE"
  | "AUTO_FIELD_ACTIVE"
  | "AUTO_DRAW"
  | "AUTO_FILE_ADD"
  | "MAIN_IDLE"
  | "CARD_USED"
  | "CHARACTER_ENTERED"
  | "CHARACTER_REMOVED_FROM_FIELD"
  | "DEDUCTION_DECLARED"
  | "DEDUCTION_MISLEAD_WINDOW"
  | "DEDUCTION_EVIDENCE_GAIN"
  | "ACTION_DECLARED"
  | "GUARD_WINDOW"
  | "CONTACT_START"
  | "CONTACT_RESPONSE"
  | "CONTACT_AP_CHECK"
  | "CONTACT_END"
  | "ACTION_END"
  | "TURN_END";
```

Do not treat this enum as official terminology; it is a proposed engineering mapping.

---

# 30. Minimum Game State Suggested by the Rules

This is an implementation-oriented model derived from the manual.

```ts
interface GameState {
  matchId: string;
  turnNumber: number;
  turnPlayerId: PlayerId;
  firstPlayerId: PlayerId;
  phase: "AUTO" | "MAIN" | "END";

  players: Record<PlayerId, PlayerState>;

  currentProcedure?: ProcedureState;
  pendingEffects: PendingEffect[];
  winnerId?: PlayerId;
  endReason?: "CASE_SOLVED" | "REFRESH_WITH_EMPTY_REMOVE";
}

interface PlayerState {
  partner: CardInstanceId;
  caseCard: CardInstanceId;
  caseSide: "CASE" | "RESOLUTION";

  deck: CardInstanceId[];
  hand: CardInstanceId[];
  field: CardInstanceId[];
  evidence: CardInstanceId[];
  fileArea: CardInstanceId[];
  removeArea: CardInstanceId[];
  partnerAreaExtra: CardInstanceId[];

  traceState: "UNDISCOVERED" | "DISCOVERED";

  usedNormalHandPlayThisTurn: boolean;
  usedNextHintThisTurn: boolean;
}
```

Each Character instance should separately store:

```ts
interface CharacterRuntimeState {
  orientation: "ACTIVE" | "SLEEP" | "STUN";
  enteredThisTurn: boolean;
  setCards: CardInstanceId[];
  underCards: CardInstanceId[];
  runtimeModifiers: Modifier[];
  grantedAbilities: RuntimeAbility[];
}
```

---

# 31. Core Engine Invariants

These should become automated tests before building online multiplayer.

1. Main deck always begins with exactly 40 cards.
2. No more than 3 copies of one ID in a legal deck.
3. Field never resolves to more than 5 Characters.
4. Normal card use is limited to once per turn.
5. Normal card use cannot occur after Next Hint in the same turn.
6. Next Hint removes the current top eligible FILE card before Level is checked for its optional card use.
7. Partner in FILE due to Assist counts toward FILE quantity but cannot be taken as the Next Hint top card.
8. First player's first Auto Phase adds only 1 FILE card; other normal turns add 2.
9. First player still draws on turn 1.
10. Stun -> would Active => Sleep.
11. A newly entered Character normally cannot Deduce or Action for the rest of that turn.
12. Newly entered Character can still Guard and use Declare ability if otherwise legal.
13. Deduction gains max(final LP, 0) Evidence under the manual's LP<=0 rule.
14. Action [Case] removes exactly 1 opponent Evidence and gains exactly 1 own Evidence.
15. Attacker removes opposing Contact Character when attacker AP >= opposing AP.
16. Attacker is not automatically removed by Contact AP comparison.
17. Refresh occurs immediately when Deck becomes empty, even during effect resolution.
18. Refresh with empty Remove Area loses the game.
19. Opponent gains 1 Evidence each time you successfully Refresh.
20. Triggered abilities that have triggered are not cancelled merely because source later leaves Field or becomes invalid, unless an explicit negate rule applies.
21. Pending effects of turn player resolve before pending effects of non-turn player when both have unresolved effects.
22. Set cards and cards stacked underneath are separate mechanics.
23. Disguise inherits runtime state/effects/attachments but replaces printed identity.
24. Disguise is not normal entry; `変装時` is its dedicated trigger.
25. Original LP/AP=0 changes base value, not already-applied modifiers.
26. Invalidating original abilities does not delete granted abilities or already-triggered effects.

---

# 32. RULE-QUESTION Backlog

These items should be resolved before a production-grade rules engine. They are intentionally **not** guessed from general TCG knowledge.

### RULE-QUESTION-001 — Tournament/event deck rules
Additional event-specific construction restrictions may exist outside the manual.

### RULE-QUESTION-002 — Draw / simultaneous terminal states
No generic tie resolution is defined in this manual.

### RULE-QUESTION-003 — Multiple replacement effects
The Ver.2.5 manual explains immediate `instead` / `negate` handling but does not fully specify precedence when several replacements compete for the same event.

### RULE-QUESTION-004 — MR card-specific behavior
General MR rules are present, but individual MR abilities require card data.

### RULE-QUESTION-005 — Future multi-name syntax
Only the naming conventions currently described in the manual should be recognized automatically.

### RULE-QUESTION-006 — Complete color enum
The manual demonstrates color-based rules but this implementation file does not infer the complete legal color list. Populate colors from the official card database/card set.

### RULE-QUESTION-007 — Full card effect grammar
The rule manual defines common semantics, not every effect phrase used on all released cards. A card corpus is required before designing a complete DSL/effect parser.

### RULE-QUESTION-008 — Official comprehensive rules / Q&A precedence
Before implementing unusual edge cases, obtain official comprehensive rules and Q&A if available. Card text and later official rulings may override a simplified interpretation from this manual.

---

# 33. Recommended Next Step for Codex

Do **not** build React UI yet.

Codex should next convert this document into:

1. `docs/digital-rules.md`
   - exact state-machine behavior;
   - preconditions/postconditions for each action;
   - effect timing rules.

2. `docs/game-flow.md`
   - setup state diagram;
   - phase state diagram;
   - Deduction sequence;
   - Action/Guard/Contact sequence;
   - Refresh interrupt sequence.

3. `docs/card-schema.md`
   - JSON schema for Partner / Character / Event / Case;
   - runtime instance state separate from immutable card definition.

4. `tests/rules/`
   - one test per invariant listed in section 31.

Implementation must stop and create a `RULE-QUESTION` whenever behavior cannot be derived from this document plus the official PDF.

---

## End of `original-rules.md`
