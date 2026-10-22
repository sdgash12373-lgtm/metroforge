/** What changed in each release, newest first. Shown on the start screen and in the in-game ticker. */
export interface Release {
  version: string;
  date: string;
  title: string;
  notes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '1.0.0',
    date: '2026-10-22',
    title: 'Metroforge：都市創造 正式登場',
    notes: [
      '遊戲正式更名為 Metroforge：都市創造，換上新商標',
      '新增「建設」：公園、學校、警察局、消防局、醫院，各有服務範圍',
      '新增城市地標：85大樓、市政府、龍虎塔、摩天輪、巨蛋，帶來觀光客與觀光收入',
      '新增「需求」面板：居民滿意度、各項公共服務涵蓋率與居民心聲',
      '貨幣改為新台幣（NT$），時間改用西元年月日與時分秒',
      '每次更新會在開始畫面與遊戲上方跑馬燈提醒',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-22',
    title: '高雄地形與存檔欄位',
    notes: [
      '新城市地形參考高雄：海岸、平原、河流與東北高山',
      '路口自動設置紅綠燈；電腦拉路按右鍵結束',
      '運輸工具新增「拆除路線」；捷運站縮小，拉捷運軌道時不會被道路擋住',
      '開始畫面、6 個存檔欄位加自動存檔，可匯出匯入',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-21',
    title: '捷運、火車、高鐵與機場',
    notes: ['捷運、火車、高鐵軌道與車站', '機場與航班', '路名與區域命名'],
  },
  {
    version: '0.4.0',
    date: '2026-10-21',
    title: '公車與高架道路',
    notes: ['公車路線與票價', '高架與地下道路、圓環'],
  },
];

export const VERSION = CHANGELOG[0].version;
