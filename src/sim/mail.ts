import { type City, DEFAULT_TAX, type Rng, budgetTotals } from './city';
import { SERVICE_KINDS, type ServiceKind } from './facilities';
import type { Vec2 } from './geometry';
import { ZONES, Zone } from './zoning';

/** 市民信箱: what residents write in about, and how it reads. */
export type Tone = 'mood' | 'idea' | 'suggest' | 'complain';

export const TONES: Record<Tone, { label: string; icon: string }> = {
  mood: { label: '心情', icon: '😊' },
  idea: { label: '想法', icon: '💡' },
  suggest: { label: '建議', icon: '📝' },
  complain: { label: '抱怨', icon: '😤' },
};

export interface Letter {
  /** what it is about, so the same subject doesn't come up twice running */
  topic: string;
  tone: Tone;
  from: string;
  face: string;
  text: string;
  /** where the writer means, for a tap to look at */
  at?: Vec2;
}

/** Who writes in: everyday Taiwanese names, young and old. */
const WRITERS: [string, string][] = [
  ['陳媽媽', '👩'],
  ['林阿伯', '👴'],
  ['王小明', '👦'],
  ['黃阿姨', '👩‍🦱'],
  ['張同學', '🧑‍🎓'],
  ['李老闆', '🧔'],
  ['吳阿嬤', '👵'],
  ['劉先生', '👨'],
  ['蔡小姐', '👱‍♀️'],
  ['楊太太', '👩‍🦰'],
  ['許大哥', '🧑'],
  ['鄭阿公', '👴'],
  ['謝老師', '🧑‍🏫'],
  ['洪司機', '🧑‍✈️'],
  ['郭工程師', '👨‍💻'],
  ['周護理師', '👩‍⚕️'],
  ['曾小妹', '👧'],
  ['廖上班族', '🧑‍💼'],
  ['賴阿姨', '👩‍🍳'],
  ['蕭外送員', '🛵'],
];

/** One thing residents may write about: how keen they are, what they might say, and where. */
interface Subject {
  topic: string;
  tone: Tone;
  weight: number;
  texts: string[];
  at?: Vec2;
}

/** What residents say about each service, missing and present. */
const SERVICE_TALK: Record<ServiceKind, { lack: string[]; idea: string[]; praise: string[] }> = {
  park: {
    lack: ['家附近連一個公園都沒有，小孩只能在騎樓跑來跑去', '想去散步都只能走大馬路邊，吸一堆廢氣', '傍晚想跳個廣場舞，找不到地方啦'],
    idea: ['可以在我們這區蓋個公園嗎？有涼亭跟大榕樹就很棒', '希望有一座有溜滑梯的公園，假日帶孩子去放電'],
    praise: ['早上去公園做運動，空氣很好，一整天精神都好', '公園的涼亭很適合下棋泡茶，感謝市長', '孫子最喜歡公園的溜滑梯了'],
  },
  school: {
    lack: ['孩子上學要騎好遠的車，每天早上都很趕', '附近沒有學校，搬來這裡有點後悔', '學區太遠了，接送好累'],
    idea: ['希望在附近蓋一所國小，孩子走路就能上學', '學校旁邊可以順便蓋個圖書館嗎？'],
    praise: ['學校就在家旁邊，孩子可以多睡十分鐘', '國小的操場晚上開放，很多人去慢跑', '新學校好漂亮，孩子每天都很期待上學'],
  },
  police: {
    lack: ['最近機車被偷了兩次，附近連派出所都沒有', '晚上回家巷子很暗，有點怕怕的', '社區最近治安不太好，希望多一點警察巡邏'],
    idea: ['希望附近設一個派出所，晚上比較安心', '巡邏箱可以多放幾個在巷口嗎？'],
    praise: ['警察每天都有巡邏，晚上走路很安心', '派出所的警員幫我找回走失的狗狗，太感謝了'],
  },
  fire: {
    lack: ['附近沒有消防隊，萬一失火怎麼辦', '巷子裡都是鐵皮屋，沒有消防局真的很危險'],
    idea: ['希望附近設一個消防分隊，大家住得比較安心', '可以辦一場防災演練嗎？'],
    praise: ['消防隊來社區教大家用滅火器，很實用', '上次瓦斯外洩，消防隊幾分鐘就到了，真的很感謝'],
  },
  hospital: {
    lack: ['半夜孩子發燒，要開好遠才找得到醫院', '老人家看病要轉兩班車，太辛苦了', '附近沒有急診，住得很不安心'],
    idea: ['希望蓋一間有急診的醫院，離家近一點', '可以多開幾間社區診所嗎？'],
    praise: ['醫院離家近，回診方便多了', '醫院的護理師好親切，看病不再那麼緊張'],
  },
};

const pick = <T>(xs: readonly T[], rand: Rng): T => xs[Math.floor(rand() * xs.length) % xs.length];

/** A random home (or other lot) that passes `ok`, from a scan that starts at a random place. */
function findLot(city: City, rand: Rng, ok: (zone: Zone, lot: { x: number; y: number; level: number }) => boolean, tries = 600): Vec2 | undefined {
  const segs = [...city.net.segments.values()];
  if (!segs.length) return undefined;
  const start = Math.floor(rand() * segs.length);
  let looked = 0;
  for (let i = 0; i < segs.length && looked < tries; i++) {
    const seg = segs[(start + i) % segs.length];
    for (const lot of seg.lots) {
      if (lot.blocked || !lot.level || lot.zone === Zone.None) continue;
      looked++;
      if (ok(lot.zone, lot)) return { x: lot.x, y: lot.y };
    }
  }
  return undefined;
}

const isHome = (z: Zone) => z !== Zone.None && ZONES[z as Exclude<Zone, Zone.None>].demand === 'R';

/** The most jammed street, from a sample of the network, and its name if it has one. */
function jammedRoad(city: City, rand: Rng): { at: Vec2; name?: string; jam: number } | null {
  const segs = [...city.net.segments.values()].filter((s) => !s.highway);
  if (!segs.length) return null;
  let best: { at: Vec2; name?: string; jam: number } | null = null;
  const n = Math.min(segs.length, 160);
  const start = Math.floor(rand() * segs.length);
  for (let i = 0; i < n; i++) {
    const seg = segs[(start + Math.floor((i * segs.length) / n)) % segs.length];
    const jam = city.congestion(seg);
    if (!best || jam > best.jam) {
      const mid = seg.samples[Math.floor(seg.samples.length / 2)];
      best = { at: { x: mid.x, y: mid.y }, name: seg.name, jam };
    }
  }
  return best;
}

/**
 * What residents have on their minds right now, weighted by how strongly the city gives them
 * reason to say it: missing services and jams draw complaints, good coverage draws thanks, and
 * there are always a few everyday thoughts and ideas. `recent` topics are left out so the box
 * doesn't repeat itself. Returns null before anyone lives in the city.
 */
export function composeLetter(city: City, rand: Rng, hour: number, recent: readonly string[] = []): Letter | null {
  const pop = city.stats.population;
  if (pop <= 0) return null;
  const subjects: Subject[] = [];
  const add = (s: Subject) => {
    if (s.weight > 0 && !recent.includes(s.topic)) subjects.push(s);
  };
  const n = city.needs;
  for (const k of SERVICE_KINDS) {
    const cover = n.coverage[k];
    const talk = SERVICE_TALK[k];
    if (cover < 0.6) {
      const at = findLot(city, rand, (z, lot) => isHome(z) && !city.servicesAt(lot).kinds.has(k));
      add({ topic: `lack-${k}`, tone: 'complain', weight: 3 * (1 - cover), texts: talk.lack, at });
      add({ topic: `idea-${k}`, tone: 'suggest', weight: 1.5 * (1 - cover), texts: talk.idea, at });
    }
    if (cover > 0.5) {
      const own = [...city.facilities.values()].filter((f) => f.kind === k);
      add({ topic: `praise-${k}`, tone: 'mood', weight: cover, texts: talk.praise, at: own.length ? pick(own, rand).p : undefined });
    }
  }
  // Traffic
  const jam = jammedRoad(city, rand);
  if (jam && jam.jam > 0.55) {
    const road = jam.name ?? '這條路';
    add({
      topic: 'jam',
      tone: 'complain',
      weight: 4 * jam.jam,
      texts: [`${road}每天上下班都塞爆，騎機車都鑽不過去`, `${road}的紅綠燈可以調一下嗎？等三次綠燈還過不去`, `${road}塞車塞到外送都超時了`],
      at: jam.at,
    });
    add({ topic: 'jam-idea', tone: 'idea', weight: 1.5 * jam.jam, texts: ['路口太塞了，要不要考慮蓋圓環或拓寬成雙線道？', '如果有公車或捷運，我就不用每天開車塞在路上了'], at: jam.at });
  }
  // Money and taxes
  const tax = city.taxes.residential;
  if (tax > DEFAULT_TAX + 2) add({ topic: 'tax-high', tone: 'complain', weight: (tax - DEFAULT_TAX) * 0.5, texts: ['稅一直漲，薪水都沒漲，日子很難過', `居民稅 ${tax}% 太高了吧，考慮搬到隔壁縣市了`] });
  if (tax < DEFAULT_TAX) add({ topic: 'tax-low', tone: 'mood', weight: 1, texts: ['今年稅比較低，多了點錢可以帶家人去吃好料'] });
  if (city.taxes.business > DEFAULT_TAX + 3) add({ topic: 'biz-tax', tone: 'complain', weight: 1.5, texts: ['營業稅太重了，小本生意快撐不下去', '店租跟稅都漲，雞排只好漲價了'] });
  if (city.money < 0) add({ topic: 'broke', tone: 'complain', weight: 3, texts: ['聽說市庫已經沒錢了，市長要不要省一點？', '市政府是不是快破產了？好擔心'] });
  if (budgetTotals(city.budget).balance > 0 && city.money > 500_000) add({ topic: 'rich', tone: 'idea', weight: 0.6, texts: ['市庫好像很有錢，可以辦個跨年煙火嗎？', '錢夠的話可以多蓋點自行車道嗎？'] });
  // Jobs, homes and shops
  const jobs = city.stats.jobs;
  if (pop > 40 && jobs < pop * 0.45) add({ topic: 'no-jobs', tone: 'complain', weight: 2, texts: ['投了好多履歷都沒回音，附近工作好少', '每天要通勤去別的城市上班，好累', '希望多一些公司和工廠進駐，提供工作機會'] });
  if (pop > 40 && jobs > pop * 1.2) add({ topic: 'no-staff', tone: 'complain', weight: 1.5, texts: ['店裡缺人缺很久了，徵不到員工', '工廠開出好條件還是找不到人，附近住宅太少了'] });
  if (city.demand.R > 70) add({ topic: 'housing', tone: 'suggest', weight: 1.5, texts: ['房價越來越貴，希望多規劃一些住宅區', '想搬來這裡住，但找不到房子'] });
  if (city.demand.C > 70) add({ topic: 'shops', tone: 'suggest', weight: 1.5, texts: ['附近連一間便利商店都沒有，想買個飲料好麻煩', '希望多一點商店街，晚上可以逛逛'] });
  if (n.polluted > 0.02) {
    const at = findLot(city, rand, (z) => z === Zone.Chemical);
    add({ topic: 'smog', tone: 'complain', weight: 3 * Math.min(1, n.polluted * 5), texts: ['化工廠的味道好重，衣服都不敢曬在外面', '最近孩子一直咳嗽，是不是工廠空汙太嚴重？'], at });
  }
  if (city.stats.disconnected > 0) {
    const at = city.disconnectedLots({ x: 0, y: 0 })[0];
    add({ topic: 'cut-off', tone: 'complain', weight: 1.5, texts: ['我家前面的路沒有接到外面，建商都不敢蓋房子', '那一區的路斷掉了，什麼都蓋不起來'], at });
  }
  // Getting around
  const lines = city.transits.reduce((s, t) => s + t.lines.size, 0);
  if (pop > 1500 && !lines) add({ topic: 'no-bus', tone: 'suggest', weight: 2, texts: ['希望有公車可以搭，老人家不會騎車', '要是有捷運就好了，每天塞車好浪費時間'] });
  if (lines) add({ topic: 'bus', tone: 'mood', weight: 0.8, texts: ['每天搭公車上班，看看窗外的風景也不錯', '捷運跟公車越來越方便，我都不開車了'] });
  const own = (kind: string) => [...city.facilities.values()].filter((f) => f.kind === kind);
  const markets = own('nightMarket');
  if (markets.length) add({ topic: 'night-market', tone: 'mood', weight: 1.2, texts: ['下班去夜市吃雞排配珍奶，一天的疲勞都不見了', '夜市的蚵仔煎超好吃，週末一定要去', '帶孩子去夜市撈金魚，玩得好開心'], at: pick(markets, rand).p });
  const docks = own('youbike');
  if (docks.length) add({ topic: 'youbike', tone: 'mood', weight: 0.9, texts: ['騎 YouBike 去捷運站，又快又環保', '家門口就有 YouBike 站，買菜方便多了'], at: pick(docks, rand).p });
  else if (pop > 2000) add({ topic: 'want-youbike', tone: 'suggest', weight: 0.8, texts: ['希望附近設 YouBike 站，短程騎車就好不用開車'] });
  const garages = city.parkingWanted.size;
  if (!garages && pop > 3000 && jobs > 1500) add({ topic: 'no-parking', tone: 'suggest', weight: 1.2, texts: ['開車去市區都找不到停車位，可以蓋公有停車場嗎？', '路邊違停好多，希望多蓋幾座停車場'] });
  if (garages && city.parkingFee >= 60) {
    const own = [...city.facilities.values()].filter((f) => f.kind === 'parking');
    add({ topic: 'parking-fee', tone: 'complain', weight: (city.parkingFee - 40) / 20, texts: [`停車一小時 ${city.parkingFee} 元也太貴了吧`, '停車費漲成這樣，我寧願停遠一點走路'], at: pick(own, rand).p });
  }
  if (garages && city.parkingFee <= 20) add({ topic: 'parking-cheap', tone: 'mood', weight: 0.8, texts: ['公有停車場好便宜，去市區買東西方便多了'] });
  const scooters = city.households.people.scooter ?? 0;
  if (scooters > pop * 0.3) add({ topic: 'scooter', tone: 'complain', weight: 1, texts: ['機車停車格永遠不夠，每天都在找位子', '騎樓被機車停滿，推嬰兒車都過不去'] });
  if (n.tourists > 0) add({ topic: 'tourists', tone: 'mood', weight: 1, texts: ['觀光客變多了，店裡生意好很多', '假日到處都是觀光客，好熱鬧'] });
  // Weather and the time of day
  const sky = city.weather.sky;
  if (sky === 'rain' || sky === 'storm') add({ topic: 'rain', tone: 'mood', weight: 1.5, texts: ['下雨天騎機車穿雨衣好悶', '又下雨了，還好騎樓可以躲雨'] });
  if (sky === 'typhoon') add({ topic: 'typhoon', tone: 'idea', weight: 3, texts: ['颱風來了，明天會放颱風假嗎？', '颱風天記得把陽台的盆栽收進來喔'] });
  if (hour >= 20 || hour < 2) add({ topic: 'night', tone: 'idea', weight: 1, texts: ['好想要有一個夜市，下班可以去吃宵夜', '晚上的街道好安靜，路燈很漂亮'] });
  if (hour >= 6 && hour < 9) add({ topic: 'morning', tone: 'mood', weight: 0.8, texts: ['早餐店的蛋餅配奶茶，一天的開始', '早上買菜，菜市場好熱鬧'] });
  // How people feel overall, and ideas for the city
  if (n.happiness >= 75) add({ topic: 'happy', tone: 'mood', weight: 1.5, texts: [`住在${city.name}好幸福，謝謝市長`, '這座城市越來越好了，朋友都想搬過來'] });
  if (n.happiness < 40) add({ topic: 'unhappy', tone: 'complain', weight: 2, texts: ['住在這裡越來越不開心，公共設施都不夠', '市長，你到底有沒有在聽我們說話？'] });
  add({
    topic: 'dream',
    tone: 'idea',
    weight: 0.6,
    texts: ['要是有一座摩天輪就好了，可以約會', '希望多種一些行道樹，夏天走路比較涼', '可以在河邊蓋腳踏車道嗎？', '城市要是有一座巨蛋，就能看演唱會了', '希望有更多 YouBike 站'],
  });
  if (!subjects.length) return null;
  let total = 0;
  for (const s of subjects) total += s.weight;
  let r = rand() * total;
  let chosen = subjects[subjects.length - 1];
  for (const s of subjects) {
    r -= s.weight;
    if (r <= 0) {
      chosen = s;
      break;
    }
  }
  const [from, face] = pick(WRITERS, rand);
  return { topic: chosen.topic, tone: chosen.tone, from, face, text: pick(chosen.texts, rand), at: chosen.at };
}

