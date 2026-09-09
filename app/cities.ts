// 中国主要城市/拍摄地坐标库 + 拍摄价值批量评分
// 评分规则完全复用主程序（page.tsx）的判定体系：
//   targetIndex 目标云层 → illum 受光判断（calcOvercast/dip）→
//   geometryScore / cloudScore / airScore / corridorScore →
//   probabilityScore / qualityScore / score → 出行建议分级
import { getTimes, getPosition } from "suncalc";
import { withTimeout } from "./abort";
import { calcOvercast } from "./cloud-color";
import { classifyGenus, type CloudGenus } from "./cloud-genus";
import { cloudProfile, type CloudLayerProfile } from "./cloud-profile";

export type City = {
  name: string;
  province: string;
  lat: number;
  lon: number;
};

export type CityRank = City & {
  score: number;
  cloudScore: number;
  airScore: number;
  visScore: number;
  cover: [number, number, number]; // 低/中/高
  aod: number;
  precip: number;
  window: string; // 推荐拍摄时段 HH:MM–HH:MM
  setupTime: string; // 架机时刻 HH:MM（与主程序一致）
  bestTime: string; // 主拍时刻 HH:MM（与主程序一致）
  wrapTime: string; // 收尾时刻 HH:MM（与主程序一致）
  schedule: string; // 架机/主拍/收尾 组合显示
  tag: string; // 出行建议：值得专程拍摄 / 建议就近蹲守 / 不建议专程出发
  scenario: string; // 云型：高云幕型 / 中云层状型 / 低云遮挡型 / 云洞漏光型
  heights: [number, number, number]; // 低/中/高云高 km
  genus: { low: CloudGenus; mid: CloudGenus; high: CloudGenus }; // 云属
  profile: CloudLayerProfile[]; // CloudSat 云剖面（云底/云顶/厚度/水相/降水）
  overcast: number; // 阴天遮光因子
  illum: boolean[]; // 低/中/高受光状态
};

// 候选库：覆盖各气候带、平原山地高原湖泊海岸，多为热门日落/朝霞拍摄城市
export const CANDIDATES: City[] = [
  { name: "北京", province: "北京", lat: 39.904, lon: 116.407 },
  { name: "天津", province: "天津", lat: 39.084, lon: 117.201 },
  { name: "上海", province: "上海", lat: 31.23, lon: 121.474 },
  { name: "广州", province: "广东", lat: 23.129, lon: 113.264 },
  { name: "深圳", province: "广东", lat: 22.543, lon: 114.058 },
  { name: "佛山", province: "广东", lat: 23.021, lon: 113.122 },
  { name: "东莞", province: "广东", lat: 23.021, lon: 113.752 },
  { name: "珠海", province: "广东", lat: 22.271, lon: 113.577 },
  { name: "中山", province: "广东", lat: 22.517, lon: 113.393 },
  { name: "惠州", province: "广东", lat: 23.111, lon: 114.416 },
  { name: "江门", province: "广东", lat: 22.579, lon: 113.082 },
  { name: "肇庆", province: "广东", lat: 23.047, lon: 112.461 },
  { name: "香港", province: "香港", lat: 22.319, lon: 114.169 },
  { name: "澳门", province: "澳门", lat: 22.199, lon: 113.544 },
  { name: "杭州", province: "浙江", lat: 30.274, lon: 120.155 },
  { name: "苏州", province: "江苏", lat: 31.299, lon: 120.585 },
  { name: "南京", province: "江苏", lat: 32.06, lon: 118.797 },
  { name: "成都", province: "四川", lat: 30.657, lon: 104.066 },
  { name: "重庆", province: "重庆", lat: 29.563, lon: 106.551 },
  { name: "武汉", province: "湖北", lat: 30.593, lon: 114.305 },
  { name: "西安", province: "陕西", lat: 34.342, lon: 108.94 },
  { name: "长沙", province: "湖南", lat: 28.228, lon: 112.939 },
  { name: "郑州", province: "河南", lat: 34.747, lon: 113.625 },
  { name: "青岛", province: "山东", lat: 36.067, lon: 120.383 },
  { name: "济南", province: "山东", lat: 36.651, lon: 117.12 },
  { name: "威海", province: "山东", lat: 37.513, lon: 122.121 },
  { name: "昆明", province: "云南", lat: 24.88, lon: 102.833 },
  { name: "贵阳", province: "贵州", lat: 26.647, lon: 106.63 },
  { name: "南宁", province: "广西", lat: 22.817, lon: 108.366 },
  { name: "福州", province: "福建", lat: 26.074, lon: 119.297 },
  { name: "厦门", province: "福建", lat: 24.48, lon: 118.089 },
  { name: "三亚", province: "海南", lat: 18.253, lon: 109.512 },
  { name: "海口", province: "海南", lat: 20.044, lon: 110.199 },
  { name: "乌鲁木齐", province: "新疆", lat: 43.826, lon: 87.617 },
  { name: "兰州", province: "甘肃", lat: 36.061, lon: 103.834 },
  { name: "银川", province: "宁夏", lat: 38.487, lon: 106.231 },
  { name: "西宁", province: "青海", lat: 36.617, lon: 101.778 },
  { name: "呼和浩特", province: "内蒙古", lat: 40.842, lon: 111.75 },
  { name: "沈阳", province: "辽宁", lat: 41.806, lon: 123.432 },
  { name: "长春", province: "吉林", lat: 43.817, lon: 125.324 },
  { name: "哈尔滨", province: "黑龙江", lat: 45.803, lon: 126.534 },
  { name: "石家庄", province: "河北", lat: 38.043, lon: 114.515 },
  { name: "南昌", province: "江西", lat: 28.682, lon: 115.858 },
  { name: "合肥", province: "安徽", lat: 31.821, lon: 117.227 },
  { name: "太原", province: "山西", lat: 37.87, lon: 112.549 },
  { name: "拉萨", province: "西藏", lat: 29.652, lon: 91.172 },
  // 补充地级市 / 重要拍摄地
  { name: "大连", province: "辽宁", lat: 38.914, lon: 121.615 },
  { name: "鞍山", province: "辽宁", lat: 41.108, lon: 122.994 },
  { name: "丹东", province: "辽宁", lat: 40.129, lon: 124.383 },
  { name: "锦州", province: "辽宁", lat: 41.095, lon: 121.127 },
  { name: "营口", province: "辽宁", lat: 40.667, lon: 122.235 },
  { name: "盘锦红海滩", province: "辽宁", lat: 40.977, lon: 121.892 },
  { name: "葫芦岛", province: "辽宁", lat: 40.711, lon: 120.837 },
  { name: "吉林市雾凇", province: "吉林", lat: 43.838, lon: 126.566 },
  { name: "延吉", province: "吉林", lat: 42.891, lon: 129.509 },
  { name: "牡丹江", province: "黑龙江", lat: 44.551, lon: 129.633 },
  { name: "镜泊湖", province: "黑龙江", lat: 44.019, lon: 128.745 },
  { name: "大庆", province: "黑龙江", lat: 46.589, lon: 125.104 },
  { name: "齐齐哈尔", province: "黑龙江", lat: 47.354, lon: 123.918 },
  { name: "佳木斯", province: "黑龙江", lat: 46.802, lon: 130.319 },
  { name: "秦皇岛山海关", province: "河北", lat: 39.998, lon: 119.762 },
  { name: "唐山", province: "河北", lat: 39.63, lon: 118.18 },
  { name: "保定", province: "河北", lat: 38.874, lon: 115.465 },
  { name: "邯郸", province: "河北", lat: 36.625, lon: 114.539 },
  { name: "张家口崇礼", province: "河北", lat: 40.972, lon: 115.284 },
  { name: "承德避暑山庄", province: "河北", lat: 41.004, lon: 117.958 },
  { name: "沧州", province: "河北", lat: 38.304, lon: 116.857 },
  { name: "廊坊", province: "河北", lat: 39.538, lon: 116.684 },
  { name: "烟台蓬莱", province: "山东", lat: 37.811, lon: 120.759 },
  { name: "威海成山头", province: "山东", lat: 37.398, lon: 122.698 },
  { name: "日照", province: "山东", lat: 35.416, lon: 119.527 },
  { name: "潍坊", province: "山东", lat: 36.707, lon: 119.162 },
  { name: "济宁曲阜", province: "山东", lat: 35.589, lon: 116.988 },
  { name: "临沂", province: "山东", lat: 35.053, lon: 118.357 },
  { name: "淄博", province: "山东", lat: 36.814, lon: 118.055 },
  { name: "东营黄河口", province: "山东", lat: 37.434, lon: 118.674 },
  { name: "枣庄台儿庄", province: "山东", lat: 34.557, lon: 117.731 },
  { name: "菏泽", province: "山东", lat: 35.234, lon: 115.481 },
  { name: "无锡太湖", province: "江苏", lat: 31.491, lon: 120.312 },
  { name: "常州", province: "江苏", lat: 31.771, lon: 119.974 },
  { name: "徐州云龙湖", province: "江苏", lat: 34.261, lon: 117.186 },
  { name: "南通", province: "江苏", lat: 31.98, lon: 120.894 },
  { name: "连云港", province: "江苏", lat: 34.597, lon: 119.222 },
  { name: "扬州", province: "江苏", lat: 32.394, lon: 119.413 },
  { name: "镇江", province: "江苏", lat: 32.189, lon: 119.425 },
  { name: "盐城丹顶鹤", province: "江苏", lat: 33.384, lon: 120.567 },
  { name: "宁波", province: "浙江", lat: 29.868, lon: 121.544 },
  { name: "温州", province: "浙江", lat: 28.0, lon: 120.699 },
  { name: "嘉兴乌镇", province: "浙江", lat: 30.746, lon: 120.493 },
  { name: "湖州莫干山", province: "浙江", lat: 30.62, lon: 119.838 },
  { name: "绍兴", province: "浙江", lat: 30.0, lon: 120.58 },
  { name: "金华", province: "浙江", lat: 29.104, lon: 119.649 },
  { name: "台州神仙居", province: "浙江", lat: 28.845, lon: 120.597 },
  { name: "丽水云和梯田", province: "浙江", lat: 28.108, lon: 119.566 },
  { name: "千岛湖", province: "浙江", lat: 29.605, lon: 119.03 },
  { name: "舟山普陀山", province: "浙江", lat: 30.008, lon: 122.387 },
  { name: "芜湖", province: "安徽", lat: 31.352, lon: 118.433 },
  { name: "蚌埠", province: "安徽", lat: 32.916, lon: 117.389 },
  { name: "安庆天柱山", province: "安徽", lat: 30.513, lon: 117.044 },
  { name: "池州九华山", province: "安徽", lat: 30.517, lon: 117.749 },
  { name: "宣城皖南川藏线", province: "安徽", lat: 30.462, lon: 118.729 },
  { name: "滁州琅琊山", province: "安徽", lat: 32.255, lon: 118.296 },
  { name: "六安大别山", province: "安徽", lat: 31.734, lon: 116.497 },
  { name: "泉州", province: "福建", lat: 24.874, lon: 118.676 },
  { name: "漳州土楼", province: "福建", lat: 24.513, lon: 117.647 },
  { name: "武夷山", province: "福建", lat: 27.758, lon: 118.033 },
  { name: "宁德霞浦", province: "福建", lat: 26.882, lon: 120.007 },
  { name: "莆田湄洲岛", province: "福建", lat: 25.077, lon: 119.12 },
  { name: "龙岩", province: "福建", lat: 25.075, lon: 117.017 },
  { name: "景德镇", province: "江西", lat: 29.272, lon: 117.178 },
  { name: "九江庐山", province: "江西", lat: 29.657, lon: 115.983 },
  { name: "鹰潭龙虎山", province: "江西", lat: 28.141, lon: 117.002 },
  { name: "上饶三清山", province: "江西", lat: 28.868, lon: 118.248 },
  { name: "吉安井冈山", province: "江西", lat: 26.571, lon: 114.165 },
  { name: "宜春明月山", province: "江西", lat: 27.724, lon: 114.384 },
  { name: "赣州", province: "江西", lat: 25.831, lon: 114.935 },
  { name: "洛阳龙门石窟", province: "河南", lat: 34.62, lon: 112.454 },
  { name: "开封", province: "河南", lat: 34.798, lon: 114.307 },
  { name: "安阳殷墟", province: "河南", lat: 36.097, lon: 114.392 },
  { name: "新乡郭亮村", province: "河南", lat: 35.583, lon: 113.664 },
  { name: "焦作云台山", province: "河南", lat: 35.259, lon: 113.336 },
  { name: "南阳", province: "河南", lat: 33.0, lon: 112.528 },
  { name: "信阳鸡公山", province: "河南", lat: 31.829, lon: 114.057 },
  { name: "三门峡黄河", province: "河南", lat: 34.775, lon: 111.2 },
  { name: "驻马店嵖岈山", province: "河南", lat: 33.038, lon: 113.821 },
  { name: "宜昌三峡", province: "湖北", lat: 30.692, lon: 111.287 },
  { name: "襄阳", province: "湖北", lat: 32.009, lon: 112.123 },
  { name: "十堰武当山", province: "湖北", lat: 32.644, lon: 110.838 },
  { name: "荆州", province: "湖北", lat: 30.335, lon: 112.24 },
  { name: "黄冈大别山", province: "湖北", lat: 30.676, lon: 114.877 },
  { name: "恩施大峡谷", province: "湖北", lat: 30.272, lon: 109.482 },
  { name: "神农架", province: "湖北", lat: 31.749, lon: 110.668 },
  { name: "衡阳衡山", province: "湖南", lat: 27.234, lon: 112.687 },
  { name: "岳阳洞庭湖", province: "湖南", lat: 29.357, lon: 113.129 },
  { name: "株洲", province: "湖南", lat: 27.827, lon: 113.134 },
  { name: "湘潭韶山", province: "湖南", lat: 27.914, lon: 112.527 },
  { name: "常德桃花源", province: "湖南", lat: 29.032, lon: 111.699 },
  { name: "郴州东江湖", province: "湖南", lat: 25.776, lon: 113.117 },
  { name: "湘西凤凰古城", province: "湖南", lat: 27.949, lon: 109.597 },
  { name: "邵阳崀山", province: "湖南", lat: 26.438, lon: 110.807 },
  { name: "娄底湄江", province: "湖南", lat: 27.697, lon: 111.998 },
  { name: "汕头南澳岛", province: "广东", lat: 23.38, lon: 117.008 },
  { name: "韶关丹霞山", province: "广东", lat: 24.947, lon: 113.749 },
  { name: "湛江", province: "广东", lat: 21.271, lon: 110.359 },
  { name: "茂名中国第一滩", province: "广东", lat: 21.507, lon: 111.04 },
  { name: "阳江海陵岛", province: "广东", lat: 21.656, lon: 111.905 },
  { name: "汕尾", province: "广东", lat: 22.786, lon: 115.375 },
  { name: "河源万绿湖", province: "广东", lat: 23.743, lon: 114.7 },
  { name: "清远", province: "广东", lat: 23.699, lon: 113.061 },
  { name: "潮州", province: "广东", lat: 23.657, lon: 116.622 },
  { name: "揭阳", province: "广东", lat: 23.547, lon: 116.373 },
  { name: "梅州", province: "广东", lat: 24.289, lon: 116.122 },
  { name: "柳州", province: "广西", lat: 24.326, lon: 109.428 },
  { name: "北海涠洲岛", province: "广西", lat: 21.041, lon: 109.114 },
  { name: "防城港", province: "广西", lat: 21.687, lon: 108.354 },
  { name: "百色德天瀑布", province: "广西", lat: 22.968, lon: 106.779 },
  { name: "贺州黄姚古镇", province: "广西", lat: 24.419, lon: 111.576 },
  { name: "崇左", province: "广西", lat: 22.377, lon: 107.365 },
  { name: "文昌", province: "海南", lat: 19.543, lon: 110.797 },
  { name: "琼海博鳌", province: "海南", lat: 19.25, lon: 110.494 },
  { name: "万宁石梅湾", province: "海南", lat: 18.794, lon: 110.281 },
  { name: "陵水", province: "海南", lat: 18.506, lon: 110.038 },
  { name: "儋州", province: "海南", lat: 19.521, lon: 109.581 },
  { name: "乐山峨眉山", province: "四川", lat: 29.582, lon: 103.761 },
  { name: "绵阳", province: "四川", lat: 31.468, lon: 104.68 },
  { name: "德阳三星堆", province: "四川", lat: 31.127, lon: 104.398 },
  { name: "宜宾蜀南竹海", province: "四川", lat: 28.752, lon: 104.621 },
  { name: "南充阆中古城", province: "四川", lat: 31.558, lon: 105.994 },
  { name: "甘孜康定", province: "四川", lat: 30.054, lon: 101.957 },
  { name: "色达", province: "四川", lat: 32.274, lon: 100.336 },
  { name: "泸州", province: "四川", lat: 28.872, lon: 105.443 },
  { name: "广元剑门关", province: "四川", lat: 32.33, lon: 105.548 },
  { name: "雅安牛背山", province: "四川", lat: 29.722, lon: 102.208 },
  { name: "巴中光雾山", province: "四川", lat: 32.412, lon: 106.831 },
  { name: "凉山邛海", province: "四川", lat: 27.841, lon: 102.26 },
  { name: "自贡", province: "四川", lat: 29.339, lon: 104.778 },
  { name: "遵义", province: "贵州", lat: 27.725, lon: 106.927 },
  { name: "安顺黄果树", province: "贵州", lat: 26.246, lon: 105.84 },
  { name: "铜仁梵净山", province: "贵州", lat: 27.897, lon: 109.17 },
  { name: "黔东南苗寨", province: "贵州", lat: 26.583, lon: 107.977 },
  { name: "黔南荔波", province: "贵州", lat: 25.411, lon: 107.887 },
  { name: "毕节百里杜鹃", province: "贵州", lat: 27.302, lon: 105.288 },
  { name: "六盘水", province: "贵州", lat: 26.593, lon: 104.831 },
  { name: "曲靖罗平", province: "云南", lat: 25.408, lon: 104.332 },
  { name: "玉溪抚仙湖", province: "云南", lat: 24.687, lon: 102.857 },
  { name: "保山腾冲", province: "云南", lat: 25.115, lon: 98.486 },
  { name: "昭通大山包", province: "云南", lat: 27.338, lon: 103.717 },
  { name: "普洱", province: "云南", lat: 22.825, lon: 100.966 },
  { name: "红河元阳梯田", province: "云南", lat: 23.222, lon: 102.801 },
  { name: "文山普者黑", province: "云南", lat: 24.042, lon: 104.295 },
  { name: "楚雄元谋土林", province: "云南", lat: 25.509, lon: 101.873 },
  { name: "宝鸡", province: "陕西", lat: 34.362, lon: 107.235 },
  { name: "延安壶口瀑布", province: "陕西", lat: 36.117, lon: 110.163 },
  { name: "汉中", province: "陕西", lat: 33.068, lon: 107.024 },
  { name: "榆林波浪谷", province: "陕西", lat: 38.285, lon: 109.734 },
  { name: "安康瀛湖", province: "陕西", lat: 32.685, lon: 109.029 },
  { name: "咸阳", province: "陕西", lat: 34.338, lon: 108.707 },
  { name: "天水麦积山", province: "甘肃", lat: 34.526, lon: 105.902 },
  { name: "平凉崆峒山", province: "甘肃", lat: 35.543, lon: 106.685 },
  { name: "甘南扎尕那", province: "甘肃", lat: 34.026, lon: 103.665 },
  { name: "酒泉卫星发射", province: "甘肃", lat: 40.969, lon: 100.299 },
  { name: "陇南官鹅沟", province: "甘肃", lat: 33.918, lon: 104.59 },
  { name: "海北祁连山", province: "青海", lat: 37.966, lon: 100.247 },
  { name: "海南贵德", province: "青海", lat: 36.043, lon: 101.434 },
  { name: "海西翡翠湖", province: "青海", lat: 37.846, lon: 95.302 },
  { name: "玉树", province: "青海", lat: 33.004, lon: 97.007 },
  { name: "中卫沙坡头", province: "宁夏", lat: 37.518, lon: 105.169 },
  { name: "石嘴山沙湖", province: "宁夏", lat: 38.772, lon: 106.368 },
  { name: "固原六盘山", province: "宁夏", lat: 35.673, lon: 106.285 },
  { name: "克拉玛依魔鬼城", province: "新疆", lat: 45.595, lon: 84.875 },
  { name: "哈密", province: "新疆", lat: 42.819, lon: 93.515 },
  { name: "天山天池", province: "新疆", lat: 43.884, lon: 88.131 },
  { name: "库尔勒博斯腾湖", province: "新疆", lat: 41.726, lon: 86.147 },
  { name: "阿克苏温宿", province: "新疆", lat: 41.168, lon: 80.255 },
  { name: "喀什古城", province: "新疆", lat: 39.467, lon: 75.994 },
  { name: "和田", province: "新疆", lat: 37.114, lon: 79.923 },
  { name: "赛里木湖", province: "新疆", lat: 44.574, lon: 81.33 },
  { name: "阿勒泰禾木", province: "新疆", lat: 48.566, lon: 87.432 },
  { name: "日喀则", province: "西藏", lat: 29.26, lon: 88.886 },
  { name: "山南羊卓雍措", province: "西藏", lat: 28.929, lon: 90.711 },
  { name: "昌都然乌湖", province: "西藏", lat: 29.484, lon: 96.769 },
  { name: "那曲纳木措", province: "西藏", lat: 30.774, lon: 90.668 },
  { name: "阿里冈仁波齐", province: "西藏", lat: 31.677, lon: 81.316 },
  { name: "包头", province: "内蒙古", lat: 40.657, lon: 109.84 },
  { name: "赤峰乌兰布统", province: "内蒙古", lat: 42.586, lon: 117.009 },
  { name: "鄂尔多斯响沙湾", province: "内蒙古", lat: 39.606, lon: 109.778 },
  { name: "锡林郭勒草原", province: "内蒙古", lat: 43.946, lon: 116.044 },
  { name: "阿拉善腾格里", province: "内蒙古", lat: 38.827, lon: 105.693 },
  { name: "通辽", province: "内蒙古", lat: 43.652, lon: 122.245 },
  { name: "乌兰察布", province: "内蒙古", lat: 40.994, lon: 113.132 },
  { name: "乌海", province: "内蒙古", lat: 39.674, lon: 106.822 },
  // 大型湖泊 / 高原 / 海岸线等经典拍摄地
  { name: "大理古城", province: "云南", lat: 25.677, lon: 100.182 },
  { name: "香格里拉", province: "云南", lat: 27.825, lon: 99.708 },
  { name: "泸沽湖", province: "云南", lat: 27.693, lon: 100.789 },
  { name: "丽江", province: "云南", lat: 26.872, lon: 100.23 },
  { name: "玉龙雪山", province: "云南", lat: 27.099, lon: 100.174 },
  { name: "稻城亚丁", province: "四川", lat: 28.42, lon: 100.33 },
  { name: "九寨沟", province: "四川", lat: 33.26, lon: 103.92 },
  { name: "峨眉山", province: "四川", lat: 29.52, lon: 103.33 },
  { name: "黄山", province: "安徽", lat: 30.13, lon: 118.17 },
  { name: "泰山", province: "山东", lat: 36.255, lon: 117.1 },
  { name: "华山", province: "陕西", lat: 34.474, lon: 110.087 },
  { name: "崂山", province: "山东", lat: 36.18, lon: 120.63 },
  { name: "庐山", province: "江西", lat: 29.52, lon: 115.98 },
  { name: "张家界", province: "湖南", lat: 29.35, lon: 110.55 },
  { name: "桂林", province: "广西", lat: 25.274, lon: 110.29 },
  { name: "阳朔", province: "广西", lat: 24.78, lon: 110.5 },
  { name: "东极岛", province: "浙江", lat: 30.1, lon: 122.68 },
  { name: "舟山嵊泗", province: "浙江", lat: 30.73, lon: 122.45 },
  { name: "鼓浪屿", province: "福建", lat: 24.44, lon: 118.06 },
  { name: "北戴河", province: "河北", lat: 39.83, lon: 119.49 },
  { name: "西双版纳", province: "云南", lat: 22.0, lon: 100.79 },
  { name: "吐鲁番", province: "新疆", lat: 42.95, lon: 89.18 },
  { name: "伊犁那拉提", province: "新疆", lat: 43.28, lon: 84.02 },
  { name: "喀纳斯", province: "新疆", lat: 48.76, lon: 87.01 },
  { name: "敦煌鸣沙山", province: "甘肃", lat: 40.09, lon: 94.67 },
  { name: "张掖丹霞", province: "甘肃", lat: 38.93, lon: 100.13 },
  { name: "嘉峪关", province: "甘肃", lat: 39.77, lon: 98.28 },
  { name: "青海湖", province: "青海", lat: 36.85, lon: 100.13 },
  { name: "茶卡盐湖", province: "青海", lat: 36.7, lon: 99.08 },
  { name: "额济纳胡杨林", province: "内蒙古", lat: 41.98, lon: 101.07 },
  { name: "阿尔山", province: "内蒙古", lat: 47.18, lon: 119.93 },
  { name: "满洲里", province: "内蒙古", lat: 49.59, lon: 117.39 },
  { name: "呼伦贝尔", province: "内蒙古", lat: 49.21, lon: 119.77 },
  { name: "长白山", province: "吉林", lat: 42.0, lon: 128.08 },
  { name: "武功山", province: "江西", lat: 27.46, lon: 114.15 },
  { name: "鼓浪屿·日光岩", province: "福建", lat: 24.44, lon: 118.07 },
  { name: "珠峰大本营", province: "西藏", lat: 28.14, lon: 86.85 },
  { name: "林芝", province: "西藏", lat: 29.65, lon: 94.36 },
];

const rad = (v: number) => (v * Math.PI) / 180;
const deg = (v: number) => (v * 180) / Math.PI;

// 地球曲率俯角（复用主程序 dip）：云高越高，地平线俯角越大
function dip(heightKm: number) {
  return deg(Math.acos(6371 / (6371 + heightKm)));
}

// 事件时刻偏移（复用主程序 eventDate）：offset 单位为分钟
function eventDate(event: Date, offset: number) {
  return new Date(event.getTime() + offset * 60000);
}

// 在 hourly time 数组中定位最接近某绝对时刻的下标
function indexNear(
  hourly: (string | number)[],
  targetMs: number,
): number {
  let best = 0,
    bd = Infinity;
  for (let i = 0; i < hourly.length; i++) {
    const t = new Date(String(hourly[i]) + "+08:00").getTime();
    const d = Math.abs(t - targetMs);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
function avgAround(
  arr: (number | string)[] | undefined,
  i: number,
  r = 1,
): number {
  if (!arr || !arr.length) return 0;
  let s = 0,
    n = 0;
  for (let k = -r; k <= r; k++) {
    const v = Number(arr[i + k]);
    if (Number.isFinite(v)) {
      s += v;
      n++;
    }
  }
  return n ? s / n : 0;
}

export function airScoreFromAod(aod: number): number {
  if (aod <= 0.1) return 100;
  if (aod <= 0.2) return 88;
  if (aod <= 0.3) return 72;
  if (aod <= 0.5) return 48;
  if (aod <= 0.8) return 22;
  return 6;
}

// 单城市拍摄价值评分 —— 完全复用主程序（page.tsx）判定规则：
//   targetIndex 目标云层 → illum 受光判断 → 四维评分 → 综合评分 → 出行建议
function scoreCity(
  c: City,
  date: Date,
  mode: "dawn" | "sunset",
  weather: Record<string, (number | string)[]>,
  air: Record<string, (number | string)[]> | undefined,
  elevation: number,
): CityRank {
  // date 由调用方构造为"北京当日正午"，无时区歧义，直接用于太阳时刻计算
  const t = getTimes(date, c.lat, c.lon);
  const event = mode === "sunset" ? t.sunset : t.sunrise;
  if (!event) {
    return {
      ...c,
      cover: [0, 0, 0],
      score: 0,
      cloudScore: 0,
      airScore: 0,
      visScore: 0,
      aod: 0,
      precip: 0,
      window: "--:--—--:--",
      setupTime: "--:--",
      bestTime: "--:--",
      wrapTime: "--:--",
      schedule: "--:--",
      tag: "极夜无窗口",
      scenario: "无窗口",
      heights: [1.5, 5.5, 10],
      genus: { low: "none", mid: "none", high: "none" },
      profile: [],
      overcast: 0,
      illum: [false, false, false],
    };
  }
  const time = weather.time as (string | number)[];
  const i = indexNear(time, event.getTime() - 30 * 60000);
  const cover: [number, number, number] = [
    avgAround(weather.cloud_cover_low as never, i),
    avgAround(weather.cloud_cover_mid as never, i),
    avgAround(weather.cloud_cover_high as never, i),
  ];
  const visibility = avgAround(weather.visibility as never, i) || 15000,
    precip = avgAround(weather.precipitation as never, i) || 0,
    aod = air ? avgAround(air.aerosol_optical_depth as never, i) : 0.2,
    wind = avgAround(weather.wind_speed_500hPa as never, i) || 10,
    cape = avgAround(weather.cape as never, i) || 0,
    stationElevation = elevation || 500;

  // 云高（复用主程序 geopotential 高度换算）
  const heights: [number, number, number] = [
    Math.max(
      0.5,
      (Number(weather.geopotential_height_850hPa?.[i] || 2000) -
        stationElevation) /
        1000,
    ),
    Math.max(
      3,
      (Number(weather.geopotential_height_500hPa?.[i] || 6000) -
        stationElevation) /
        1000,
    ),
    Math.max(
      7,
      (Number(weather.geopotential_height_250hPa?.[i] || 10800) -
        stationElevation) /
        1000,
    ),
  ];

  // 云属 + CloudSat 云剖面（云底/云顶/厚度/水相/降水），供迷你剖面展示
  const genus = classifyGenus({
    cape,
    precipitation: precip,
    wind,
    cover,
    heights,
  });
  const profile = cloudProfile(
    [genus.low, genus.mid, genus.high],
    heights,
    cover,
    precip,
  );

  // 太阳位置（日落/日出时刻）
  const solar = getPosition(event, c.lat, c.lon);

  // ===== 主程序判定规则 =====
  // 目标云层：高云多则看高云，否则看中云
  const targetIndex = cover[2] >= cover[1] ? 2 : 1;
  // 有效云高（AOD 衰减地面有效高度）
  const scaleHeight = 1.5,
    effectiveGround = Math.max(
      0,
      scaleHeight * Math.log(Math.max(0.001, aod) / (0.02 * scaleHeight)),
    ),
    effectiveHeights = heights.map((h) => Math.max(0.05, h - effectiveGround));
  // 阴天遮光因子
  const parentOvercast = calcOvercast(cover, precip, visibility);
  // 受光判断：太阳高于云层地平线 + 云量>5% + 非阴天遮光
  const illum = effectiveHeights.map(
    (h, k) =>
      solar.altitude > -dip(h) - 0.57 &&
      cover[k] > 5 &&
      !(k === 0 && parentOvercast > 0.4) &&
      !(parentOvercast > 0.65),
  );

  // 完全无云：目标云层云量 <= 5%，无受光无霞光 → 剔除
  if (cover[targetIndex] <= 5) {
    return {
      ...c,
      cover,
      score: 0,
      cloudScore: 0,
      airScore: airScoreFromAod(aod),
      visScore: 0,
      aod,
      precip,
      window: "--:--–--:--",
      setupTime: "--:--",
      bestTime: "--:--",
      wrapTime: "--:--",
      schedule: "--:--",
      tag: "晴空无云",
      scenario: "晴空无云",
      heights,
      genus,
      profile,
      overcast: parentOvercast,
      illum,
    };
  }

  // 几何受光：云层可见深度 vs 云边界距离
  const maxDepth = 2 * Math.sqrt(2 * 6371 * effectiveHeights[targetIndex]),
    cloudEdge = 320, // 城市推荐简化：无走廊数据，用默认云边界
    geometryScore = !illum[targetIndex]
      ? 0
      : Math.min(
          100,
          Math.round(45 + 55 * Math.min(1, maxDepth / Math.max(1, cloudEdge))),
        );
  // 云量评分（复用主程序公式）
  const cloudScore = Math.round(
    Math.min(100, cover[targetIndex] * 1.35) *
      Math.max(0.15, 1 - cover[0] / 115),
  );
  // 空气通透（AOD 分段）
  const airScore = airScoreFromAod(aod);
  // 走廊透光：低云遮挡近似太阳上游云量
  const lowerBlock = cover[0],
    corridorTransmission = Math.exp(-lowerBlock / 70),
    corridorScore = Math.round(corridorTransmission * 100);

  // ===== 拍摄时段（架机/主拍/收尾）—— 完全复用主程序 scan 逻辑 =====
  // 以事件时刻为中心 ±60 分钟，每 5 分钟一个采样点；几何受光随太阳高度变化，
  // 云量/走廊评分恒定（与主程序一致），据此得到最佳主拍时刻与可拍窗口。
  const scan = Array.from({ length: 25 }, (_, k) => {
    const m = k * 5,
      s = getPosition(eventDate(event, m - 60), c.lat, c.lon),
      eligible = mode === "dawn" ? m <= 60 : m >= 60,
      lit = s.altitude > -dip(effectiveHeights[targetIndex]) - 0.57,
      geom = lit
        ? Math.min(
            100,
            45 + 55 * Math.min(1, maxDepth / Math.max(1, cloudEdge)),
          )
        : 0;
    return {
      minute: m,
      eligible,
      score: eligible
        ? Math.round(geom * 0.48 + cloudScore * 0.32 + corridorScore * 0.2)
        : -1,
    };
  });
  const validScan = scan.filter((p) => p.eligible),
    bestPoint = validScan.reduce(
      (best, p) => (p.score > best.score ? p : best),
      validScan[0] || { minute: 60, score: 0, eligible: true },
    ),
    goodPoints = validScan.filter(
      (p) => p.score >= Math.max(52, bestPoint.score - 12),
    ),
    windowStart = goodPoints[0]?.minute ?? bestPoint.minute,
    windowEnd = goodPoints.at(-1)?.minute ?? bestPoint.minute;
  // 北京时间显示（与主程序 formatShotMinute 一致）
  const formatShotMinute = (minuteValue: number) =>
    eventDate(
      event,
      Math.max(0, Math.min(120, minuteValue)) - 60,
    ).toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const setupTime = formatShotMinute(windowStart - 10),
    bestTime = formatShotMinute(bestPoint.minute),
    wrapTime = formatShotMinute(windowEnd + 5),
    schedule = `架机${setupTime} · 主拍${bestTime} · 收尾${wrapTime}`;

  // 综合评分（复用主程序公式；蒙特卡洛简化为确定性概率）
  const deterministicProbability = Math.min(
      99,
      Math.round(geometryScore * 0.45 + cloudScore * 0.35 + corridorScore * 0.2),
    ),
    probabilityScore = deterministicProbability,
    qualityScore = Math.min(
      99,
      Math.round(
        airScore * 0.35 +
          cloudScore * 0.3 +
          geometryScore * 0.15 +
          corridorScore * 0.1 +
          cloudScore * 0.1,
      ),
    );
  let score = Math.min(
    99,
    Math.round(probabilityScore * 0.55 + qualityScore * 0.45),
  );
  // 降水不再单独重罚：与主程序一致，降水已通过 calcOvercast/受光判断体现

  // 出行建议（复用主程序分级）
  const tag =
    probabilityScore >= 72
      ? "值得专程拍摄"
      : probabilityScore >= 48
        ? "建议就近蹲守"
        : "不建议专程出发";
  // 云型识别（复用主程序 scenario）
  const scenario =
    cover[2] > 58 && cover[1] < 48
      ? "高云幕型"
      : cover[1] > 50
        ? "中云层状型"
        : cover[0] > 48
          ? "低云遮挡型"
          : "云洞漏光型";

  const mod = event.getTime();
  const from = new Date(mod - 40 * 60000),
    to = new Date(mod + 40 * 60000);
  // 统一用北京时间显示（与主程序一致），避免依赖浏览器本地时区导致时段偏移
  const fmt = (d: Date) =>
    d.toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  return {
    ...c,
    score,
    cloudScore,
    airScore,
    visScore: Math.round(corridorTransmission * 100),
    cover,
    aod,
    precip,
    window: `${fmt(from)}–${fmt(to)}`,
    setupTime,
    bestTime,
    wrapTime,
    schedule,
    tag,
    scenario,
    heights,
    genus,
    profile,
    overcast: parentOvercast,
    illum,
  };
}

// 并发批量评分：按候选库分组请求 Open-Meteo，返回按分数降序排序
export async function rankCities(
  date: Date,
  mode: "dawn" | "sunset",
  signal?: AbortSignal,
): Promise<CityRank[]> {
  const BATCH = 26;
  const result: CityRank[] = [];
  const batches: City[][] = [];
  for (let k = 0; k < CANDIDATES.length; k += BATCH)
    batches.push(CANDIDATES.slice(k, k + BATCH));

  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  for (const batch of batches) {
    const lats = batch.map((c) => c.lat).join(","),
      lons = batch.map((c) => c.lon).join(",");
    // 注意：elevation 是顶层字段，不是 hourly 变量，不能放进 hourly= 参数
    const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation,cape,wind_speed_500hPa,geopotential_height_850hPa,geopotential_height_500hPa,geopotential_height_250hPa&start_date=${dateStr}&end_date=${dateStr}&timezone=Asia%2FShanghai`;
    const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&hourly=aerosol_optical_depth&start_date=${dateStr}&end_date=${dateStr}&timezone=Asia%2FShanghai`;
    const [fc, aq] = await Promise.allSettled([
      fetch(fcUrl, { signal: withTimeout(signal, 15000) }),
      fetch(airUrl, { signal: withTimeout(signal, 15000) }),
    ]);
    if (fc.status !== "fulfilled") continue;
    let wf: any = null;
    try {
      wf = await fc.value.json();
    } catch {
      continue;
    }
    // 多坐标请求返回数组：每个坐标一个对象，各自含独立 hourly
    const cityList: any[] = Array.isArray(wf) ? wf : [wf];
    let airList: any[] = [];
    if (aq.status === "fulfilled") {
      try {
        const airJson = await aq.value.json();
        airList = Array.isArray(airJson) ? airJson : [airJson];
      } catch {
        /* ignore */
      }
    }
    cityList.forEach((cityData, bi) => {
      const city = batch[bi];
      if (!city) return;
      const w: Record<string, (number | string)[]> = cityData.hourly || {};
      const airW: Record<string, (number | string)[]> =
        airList[bi]?.hourly || {};
      result.push(
        scoreCity(city, date, mode, w, airW, cityData.elevation || 0),
      );
    });
  }
  return result
    .filter((r) => r.score > 0) // 剔除完全无云/无拍摄价值城市
    .sort((a, b) => b.score - a.score);
}