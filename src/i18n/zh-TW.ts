/** Traditional Chinese interface text. All user-facing strings live here. */
export const zhTW = {
  appName: '撲克現金局練習',
  appTagline: '9-max 無限注德州撲克 · 線下現金局訓練',

  /** Symbols and punctuation used by the interface. */
  symbols: {
    /** Clubs, diamonds, hearts, spades. The variation selector asks for a text glyph, not an emoji. */
    suits: ['♣\ufe0e', '♦\ufe0e', '♥\ufe0e', '♠\ufe0e'],
    brandMark: '♠',
    welcomeMark: '♠♥♦♣',
    close: '×',
    rangeDash: '–',
    minus: '−',
    separator: ' · ',
    colon: '：',
  },

  /** How a made hand is described with its ranks. */
  handDetail: {
    single: '{name} {a}',
    twoPair: '{name} {a}、{b}',
    fullHouse: '{name} {a} 帶 {b}',
    straight: '{name} {a} 高',
  },

  botNames: ['阿明', '小陳', '老王', '阿傑', '小林', '大偉', '阿凱', '志豪', '建宏', '家豪'],
  heroName: '你',

  action: {
    fold: '棄牌',
    check: '過牌',
    call: '跟注',
    bet: '下注',
    raise: '加注',
    allIn: '全下',
    raiseTo: '加注到',
    betAmount: '下注',
    callAllIn: '跟注全下',
    nextHand: '下一手',
    start: '開始練習',
  },

  blind: { sb: '小盲', bb: '大盲', straddle: 'Straddle' },
  street: { preflop: '翻前', flop: '翻牌', turn: '轉牌', river: '河牌' },

  table: {
    pot: '底池',
    mainPot: '主池',
    sidePot: '邊池 {n}',
    waiting: '等待 {name} 行動…',
    yourTurn: '輪到你了',
    youFolded: '你已棄牌',
    runout: '發牌中…',
    wins: '{name} 贏得 {amount}',
    winsWith: '{name}以 {hand} 贏得 {amount}',
    split: '平分底池',
    dealer: 'D',
  },

  handName: [
    '高牌',
    '一對',
    '兩對',
    '三條',
    '順子',
    '同花',
    '葫蘆',
    '四條',
    '同花順',
  ],

  log: {
    title: '本手紀錄',
    handNumber: '第 {n} 手',
    post: '{name}（{pos}）下{blind} {amount}',
    fold: '{name} 棄牌',
    check: '{name} 過牌',
    call: '{name} 跟注 {amount}',
    bet: '{name} 下注 {amount}',
    raise: '{name} 加注到 {amount}',
    allInSuffix: '（全下）',
    deal: '{street}：{cards}',
    uncalled: '退回 {name} 未被跟注的 {amount}',
    show: '{name} 亮牌 {cards}（{hand}）',
    rake: '抽水 {amount}',
    win: '{name} 贏得 {amount}',
    empty: '還沒有任何動作',
  },

  tabs: { feedback: '回饋', log: '紀錄', history: '歷史' },

  stats: {
    hands: '手數',
    net: '輸贏',
    winRate: 'BB/100',
    preflop: '翻前正確率',
    none: '—',
  },

  feedback: {
    title: '上一手的翻前評分',
    empty: '打完一手之後，這裡會顯示你的翻前決策評分。',
    noDecision: '這一手你沒有需要評分的翻前決策。',
    yourHand: '你的牌',
    chartSays: '範圍表',
    youChose: '你的選擇',
    viewChart: '看範圍表',
    approx: '這個局面沒有完全對應的範圍表，以下是最接近的參考。',
    ungraded: '這個局面目前沒有範圍表，不列入評分。',
    sizingSmall: '加注尺寸偏小（標準約 {standard}，你加到 {hero}）',
    sizingLarge: '加注尺寸偏大（標準約 {standard}，你加到 {hero}）',
    note: '範圍表是近似值，不是 solver 的輸出。',
  },

  verdict: {
    best: '最佳',
    ok: '可接受',
    inaccuracy: '不精確',
    mistake: '偏離',
    ungraded: '未評分',
  },

  choice: { fold: '棄牌', call: '跟注', check: '過牌', raise: '加注' },

  scenario: {
    rfi: '{pos} 率先入池',
    vsLimp: '{pos} 前面有人平跟',
    vsOpen: '{pos} 面對 {villain} 開池',
    squeeze: '{pos} 面對 {villain} 開池且有人跟注',
    vs3bet: '{pos} 開池後被 {villain} 3bet',
    cold3bet: '{pos} 面對開池加 3bet',
    vs4bet: '{pos} 3bet 後被 {villain} 4bet',
    vs5bet: '{pos} 面對 5bet 以上',
    other: '{pos} 其他局面',
    depth: '有效籌碼約 {depth} BB 的範圍表',
  },

  chart: {
    title: '範圍表',
    raise: '加注',
    call: '跟注',
    fold: '棄牌',
    yourHand: '你的牌',
    share: '佔全部起手牌 {pct}%',
    close: '關閉',
  },

  toast: {
    lastHand: '上一手',
    netWin: '贏 {amount}',
    netLose: '輸 {amount}',
    netEven: '不輸不贏',
  },

  history: {
    empty: '還沒有打完的手牌',
    net: '輸贏',
  },

  settings: {
    title: '設定',
    tableSection: '牌桌（變更後會重新開桌）',
    displaySection: '顯示與速度',
    numPlayers: '人數',
    heroBuyIn: '你的買入',
    botBuyIn: '對手買入範圍',
    custom: '自訂',
    topUp: '補碼方式',
    topUpAlways: '每手補滿',
    topUpBust: '籌碼太少才重買',
    straddle: 'Straddle',
    straddleOff: '關閉',
    straddleSometimes: '偶爾',
    straddleAlways: '每手',
    rake: '抽水',
    rakePercent: '比例 %',
    rakeCap: '上限 BB',
    noFlopNoDrop: '沒看翻牌不抽',
    openSize: '電腦開池尺寸',
    botSpeed: '電腦速度',
    speedFast: '快',
    speedNormal: '中',
    speedSlow: '慢',
    fourColor: '四色牌',
    unit: '金額顯示',
    unitBB: 'BB',
    unitChips: '籌碼金額',
    bigBlindAmount: '大盲金額',
    skipAfterFold: '棄牌後直接下一手',
    autoNext: '攤牌後自動下一手',
    autoNextOff: '手動',
    seconds: '{n} 秒',
    apply: '套用',
    applyRestart: '套用並重新開桌',
    cancel: '取消',
    restart: '重新開桌',
    bb: 'BB',
  },

  welcome: {
    intro: '模擬線下 9-max 現金桌。電腦依基準策略打牌，每一手結束後會為你的翻前決策評分。',
    bullets: [
      '棄牌後會直接快進到下一手',
      '快捷鍵：F 棄牌、C 過牌或跟注、R 加注、空白鍵下一手',
      '內建範圍表是近似值，之後可以換成你自己的',
    ],
    summary: '{n} 人桌 · 盲注 {sb}/{bb} · 買入 {buyIn}',
  },

  keys: { fold: 'F', call: 'C', raise: 'R', next: '空白鍵' },
};

export type Messages = typeof zhTW;
