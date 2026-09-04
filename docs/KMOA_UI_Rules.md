# K-MOA UI Design Rules & Expectations
1. QR Payment & BT Rewards UI
- NEVER display BT Reward scanning as a 'Payment'. It should be completely rewritten to emphasize 'Free Reward (무료 보상)'.
- NEVER hardcode KRW as the default currency when calculating BT or payment. Always use VND.
- BT Issuance logic is ALWAYS strictly 100,000 VND = 1 BT.
2. BT Usage (Roulette) UI
- Using BT MUST trigger an interactive visual feedback like a Roulette / Slot Machine spinning animation before showing results.
- The outcome (awarded Points/KM) MUST be explicitly and largely displayed, using bright colors (like #fde047) and big font size.
3. Don't omit parameters in function calls, check what is returned and consumed carefully (e.g. numBtEquivalent accident)!