import type { ChatResponse, TaskStatus, FinalItinerary, ItinerarySummary, Conversation, ConversationMessage, AgentStatus } from './types';

export const API_BASE = '/api';

// ── Scripted demo flow (triggered by fixed prompt) ──────────────────────────
const DEMO_TASK_PREFIX = 'demo-task-';

interface DemoStep {
  agent_name: string;
  display_name: string;
  running_message: string;
  done_summary: string;
  duration_ms: number;
  preview_image?: string;
}

const DEMO_STEPS: DemoStep[] = [
  {
    agent_name: 'intent_parser',
    display_name: '了解你的需求',
    running_message: '正在解析「湛江出发、北京7天、预算宽裕」的偏好与约束',
    done_summary: '已完成需求理解，确定行程基调为「深度文化 + 轻奢体验」',
    duration_ms: 900,
  },
  {
    agent_name: 'destination_agent',
    display_name: '查找目的地信息',
    running_message: '正在梳理北京区域特色、热门片区与7天游玩强度',
    done_summary: '已汇总北京核心片区玩法与出行注意事项',
    duration_ms: 1200,
  },
  {
    agent_name: 'attraction_agent',
    display_name: '查询热门景点',
    running_message: '正在筛选适合7天节奏的必游景点与预约时段',
    done_summary: '已筛选20个高匹配景点并标注最佳游览窗口',
    duration_ms: 1300,
  },
  {
    agent_name: 'hotel_agent',
    display_name: '挑选合适酒店',
    running_message: '正在筛选交通便利、评价稳定的高品质酒店组合',
    done_summary: '已筛选20家优质酒店，覆盖三环内多个核心区域',
    duration_ms: 1200,
  },
  {
    agent_name: 'flight_agent',
    display_name: '规划交通路线',
    running_message: '正在比对湛江往返北京的航班时段、总耗时与舒适度',
    done_summary: '已锁定7套往返交通方案并给出优先推荐',
    duration_ms: 1300,
  },
  {
    agent_name: 'local_tips_agent',
    display_name: '整理出行贴士',
    running_message: '正在整合北京本地交通规则、预约提示与高频避坑信息',
    done_summary: '已整理完整实用指南（交通、预约、天气、支付）',
    duration_ms: 1200,
  },
  {
    agent_name: 'itinerary_agent',
    display_name: '安排每日行程',
    running_message: '正在组合景点、酒店与交通，生成7天可执行路线',
    done_summary: '已生成北京7日高质量行程，含每日主题与预算建议',
    duration_ms: 1500,
  },
];

const DEMO_TOTAL_MS = DEMO_STEPS.reduce((sum, step) => sum + step.duration_ms, 0);

const DEMO_RESULT: FinalItinerary = {
  task_id: '',
  session_id: '',
  intent: {
    origin_city: '湛江',
    dest_city: '北京',
    dest_country: '中国',
    departure_date: '2026-10-10',
    return_date: '2026-10-16',
    duration_days: 7,
    budget_cny: 38000,
    travelers: 2,
    travel_style: '深度文化 + 轻奢体验',
  },
  budget: {
    total_cny: 38000,
    flight_cny: 9800,
    accommodation_cny: 14200,
    food_cny: 6800,
  },
  recommended_flight: {
    airline: '中国南方航空',
    flight_number: 'CZ6789',
    departure_time: '08:20',
    arrival_time: '12:05',
    duration_hours: 3.8,
    price_cny: 4900,
    stops: 0,
    booking_tip: '建议提前 14-21 天锁定可退改舱位',
  },
  recommended_hotel: {
    name: '北京东方景观酒店',
    stars: 5,
    area: '东城区',
    price_per_night_cny: 1980,
    total_price_cny: 11880,
    highlights: ['地铁双线步行可达', '近故宫/王府井', '高评分早餐'],
    booking_tip: '优先选择含早和免费取消房型',
  },
  weather: {
    overall_summary: '10月北京早晚偏凉，白天舒适，适合城市步行和景点游览',
    packing_suggestions: ['薄外套', '舒适步行鞋', '保温水杯', '便携雨具'],
    daily: [
      { date: '2026-10-10', condition: '晴', temp_high_c: 23, temp_low_c: 13, precipitation_mm: 0, clothing_advice: '长袖 + 薄外套' },
      { date: '2026-10-11', condition: '多云', temp_high_c: 22, temp_low_c: 12, precipitation_mm: 0, clothing_advice: '长袖 + 防风外套' },
      { date: '2026-10-12', condition: '晴', temp_high_c: 24, temp_low_c: 14, precipitation_mm: 0, clothing_advice: '长袖轻便穿搭' },
      { date: '2026-10-13', condition: '阴', temp_high_c: 21, temp_low_c: 12, precipitation_mm: 1, clothing_advice: '长袖 + 薄风衣' },
      { date: '2026-10-14', condition: '多云', temp_high_c: 20, temp_low_c: 11, precipitation_mm: 0, clothing_advice: '长袖 + 轻薄针织' },
      { date: '2026-10-15', condition: '晴', temp_high_c: 22, temp_low_c: 12, precipitation_mm: 0, clothing_advice: '长袖 + 外套' },
      { date: '2026-10-16', condition: '晴', temp_high_c: 23, temp_low_c: 13, precipitation_mm: 0, clothing_advice: '分层穿搭' },
    ],
  },
  highlights: ['故宫深度讲解', '长城私享半日游', '胡同骑行体验', '米其林与本地馆子搭配', '夜景摄影路线'],
  days: [
    {
      day_number: 1,
      date: '2026-10-10',
      theme: '抵达与中轴线初体验',
      weather_summary: '晴',
      transport_notes: '优先地铁 + 打车接驳',
      daily_budget_cny: 5200,
      meals: { breakfast: '酒店早餐', lunch: '京味餐厅', dinner: '王府井精品餐厅' },
      activities: [
        { time: '08:40', duration_minutes: 80, activity: '抵达北京并酒店寄存行李', location: '东城区', lat: 39.9149, lng: 116.4039, category: 'transport', estimated_cost_cny: 380, tips: '证件与贵重物品随身携带' },
        { time: '10:20', duration_minutes: 90, activity: '前往天安门广场打卡', location: '天安门', lat: 39.9087, lng: 116.3975, category: 'landmark', estimated_cost_cny: 60, tips: '高峰时段提前安检' },
        { time: '12:10', duration_minutes: 70, activity: '前门大街午餐与休整', location: '前门大街', lat: 39.8977, lng: 116.3972, category: 'food', estimated_cost_cny: 260, tips: '优先选择老字号避开排队店' },
        { time: '14:00', duration_minutes: 130, activity: '故宫午后经典路线预览', location: '故宫午门', lat: 39.9154, lng: 116.4039, category: 'museum', estimated_cost_cny: 180, tips: '次日深度游前先熟悉动线' },
        { time: '17:10', duration_minutes: 100, activity: '王府井晚间城市漫步', location: '王府井', lat: 39.9151, lng: 116.4119, category: 'entertainment', estimated_cost_cny: 420, tips: '晚高峰建议步行为主' },
      ],
    },
    {
      day_number: 2,
      date: '2026-10-11',
      theme: '故宫与景山',
      weather_summary: '多云',
      transport_notes: '地铁为主',
      daily_budget_cny: 5300,
      meals: { breakfast: '酒店早餐', lunch: '故宫周边简餐', dinner: '四合院创意菜' },
      activities: [
        { time: '08:20', duration_minutes: 210, activity: '故宫深度讲解游', location: '故宫博物院', lat: 39.9163, lng: 116.3972, category: 'museum', estimated_cost_cny: 320, tips: '建议使用语音讲解设备' },
        { time: '12:10', duration_minutes: 70, activity: '景山西街午餐', location: '景山西街', lat: 39.9234, lng: 116.3892, category: 'food', estimated_cost_cny: 240, tips: '中午高峰请提前取号' },
        { time: '13:40', duration_minutes: 80, activity: '景山公园俯瞰中轴线', location: '景山公园', lat: 39.9266, lng: 116.3967, category: 'nature', estimated_cost_cny: 40, tips: '万春亭视角最出片' },
        { time: '15:30', duration_minutes: 95, activity: '北海公园白塔环湖', location: '北海公园', lat: 39.9316, lng: 116.3896, category: 'nature', estimated_cost_cny: 60, tips: '可选择短程游船' },
        { time: '18:10', duration_minutes: 100, activity: '后海夜景与晚餐', location: '后海', lat: 39.9407, lng: 116.3863, category: 'entertainment', estimated_cost_cny: 520, tips: '热门餐厅建议提前预约' },
      ],
    },
    {
      day_number: 3,
      date: '2026-10-12',
      theme: '长城经典线',
      weather_summary: '晴',
      transport_notes: '包车往返更舒适',
      daily_budget_cny: 6100,
      meals: { breakfast: '酒店早餐', lunch: '长城景区简餐', dinner: '烤鸭晚餐' },
      activities: [
        { time: '07:20', duration_minutes: 120, activity: '包车前往慕田峪长城', location: '东城区出发', lat: 39.9149, lng: 116.4039, category: 'transport', estimated_cost_cny: 780, tips: '建议携带轻便外套' },
        { time: '09:40', duration_minutes: 190, activity: '慕田峪长城登城段体验', location: '慕田峪长城', lat: 40.4373, lng: 116.5704, category: 'landmark', estimated_cost_cny: 420, tips: '选择缆车上山节省体力' },
        { time: '13:10', duration_minutes: 70, activity: '长城景区午餐', location: '慕田峪服务区', lat: 40.4314, lng: 116.5682, category: 'food', estimated_cost_cny: 280, tips: '补充电解质和热量' },
        { time: '15:00', duration_minutes: 90, activity: '怀柔山景咖啡休整', location: '怀柔区', lat: 40.3225, lng: 116.6317, category: 'entertainment', estimated_cost_cny: 180, tips: '返程前可短暂休息' },
        { time: '18:30', duration_minutes: 95, activity: '全聚德/便宜坊烤鸭晚餐', location: '前门', lat: 39.8956, lng: 116.4011, category: 'food', estimated_cost_cny: 860, tips: '提前线上排号' },
      ],
    },
    {
      day_number: 4,
      date: '2026-10-13',
      theme: '博物馆与艺术区',
      weather_summary: '阴',
      transport_notes: '地铁 + 打车',
      daily_budget_cny: 5200,
      meals: { breakfast: '酒店早餐', lunch: '国贸商圈', dinner: '艺术区餐吧' },
      activities: [
        { time: '09:10', duration_minutes: 150, activity: '国家博物馆重点展参观', location: '中国国家博物馆', lat: 39.9051, lng: 116.4014, category: 'museum', estimated_cost_cny: 160, tips: '提前预约限流场次' },
        { time: '11:50', duration_minutes: 75, activity: '国贸商圈午餐', location: '国贸', lat: 39.9085, lng: 116.4579, category: 'food', estimated_cost_cny: 360, tips: '可选高层景观餐厅' },
        { time: '13:40', duration_minutes: 130, activity: '798艺术区画廊巡游', location: '798艺术区', lat: 39.9866, lng: 116.4956, category: 'museum', estimated_cost_cny: 240, tips: '部分展馆周一闭馆注意时间' },
        { time: '16:20', duration_minutes: 90, activity: '751园区工业风拍照', location: '751D.PARK', lat: 39.9886, lng: 116.4972, category: 'entertainment', estimated_cost_cny: 120, tips: '傍晚光线更好' },
        { time: '18:40', duration_minutes: 110, activity: '艺术区创意晚餐与小酒馆', location: '酒仙桥', lat: 39.9756, lng: 116.4931, category: 'food', estimated_cost_cny: 620, tips: '返程建议打车' },
      ],
    },
    {
      day_number: 5,
      date: '2026-10-14',
      theme: '胡同与本地生活',
      weather_summary: '多云',
      transport_notes: '步行 + 骑行',
      daily_budget_cny: 5000,
      meals: { breakfast: '咖啡早午餐', lunch: '胡同家常菜', dinner: '簋街夜宵' },
      activities: [
        { time: '08:50', duration_minutes: 80, activity: '鼓楼周边早餐与咖啡', location: '鼓楼', lat: 39.9481, lng: 116.3962, category: 'food', estimated_cost_cny: 220, tips: '早到避开热门排队' },
        { time: '10:20', duration_minutes: 120, activity: '什刹海胡同骑行', location: '什刹海', lat: 39.9419, lng: 116.3877, category: 'entertainment', estimated_cost_cny: 180, tips: '按规定区域停车' },
        { time: '13:00', duration_minutes: 75, activity: '南锣鼓巷特色午餐', location: '南锣鼓巷', lat: 39.9363, lng: 116.4032, category: 'food', estimated_cost_cny: 300, tips: '主街人多可走支巷' },
        { time: '15:00', duration_minutes: 105, activity: '雍和宫与国子监片区漫步', location: '雍和宫', lat: 39.9534, lng: 116.4171, category: 'landmark', estimated_cost_cny: 80, tips: '保持安静文明参观' },
        { time: '18:10', duration_minutes: 120, activity: '簋街夜宵美食线', location: '簋街', lat: 39.9389, lng: 116.4324, category: 'food', estimated_cost_cny: 560, tips: '可先线上取号再逛街' },
      ],
    },
    {
      day_number: 6,
      date: '2026-10-15',
      theme: '现代城市与购物',
      weather_summary: '晴',
      transport_notes: '地铁为主',
      daily_budget_cny: 6200,
      meals: { breakfast: '酒店早餐', lunch: '商圈轻食', dinner: '高评分融合菜' },
      activities: [
        { time: '09:30', duration_minutes: 120, activity: '国贸CBD城市天际线漫步', location: '国贸', lat: 39.9085, lng: 116.4579, category: 'entertainment', estimated_cost_cny: 160, tips: '写字楼区午间较拥挤' },
        { time: '11:40', duration_minutes: 85, activity: 'SKP午餐与买手店体验', location: 'SKP', lat: 39.9104, lng: 116.4714, category: 'food', estimated_cost_cny: 480, tips: '高端餐厅建议预约' },
        { time: '13:40', duration_minutes: 130, activity: '三里屯太古里潮流购物', location: '三里屯', lat: 39.9375, lng: 116.4551, category: 'entertainment', estimated_cost_cny: 1800, tips: '预算宽裕可预留购物额度' },
        { time: '16:30', duration_minutes: 90, activity: '亮马河国际风情水岸散步', location: '亮马河', lat: 39.9566, lng: 116.4586, category: 'nature', estimated_cost_cny: 120, tips: '黄昏时段氛围最佳' },
        { time: '19:00', duration_minutes: 120, activity: '朝阳高评分融合菜晚餐', location: '朝阳公园周边', lat: 39.9331, lng: 116.4764, category: 'food', estimated_cost_cny: 780, tips: '用餐后建议打车回酒店' },
      ],
    },
    {
      day_number: 7,
      date: '2026-10-16',
      theme: '返程前轻松收尾',
      weather_summary: '晴',
      transport_notes: '预留机场通勤时间',
      daily_budget_cny: 4700,
      meals: { breakfast: '酒店早餐', lunch: '机场附近简餐', dinner: '返程后安排' },
      activities: [
        { time: '08:50', duration_minutes: 70, activity: '酒店早餐与退房整理', location: '东城区', lat: 39.9149, lng: 116.4039, category: 'transport', estimated_cost_cny: 100, tips: '确认返程证件与机票' },
        { time: '10:10', duration_minutes: 95, activity: '北海公园轻松游览', location: '北海公园', lat: 39.9301, lng: 116.3832, category: 'nature', estimated_cost_cny: 120, tips: '可乘短程游船' },
        { time: '12:10', duration_minutes: 75, activity: '西什库片区午餐', location: '西安门大街', lat: 39.9212, lng: 116.3796, category: 'food', estimated_cost_cny: 260, tips: '保持轻餐避免返程疲劳' },
        { time: '14:10', duration_minutes: 85, activity: '首都机场贵宾休息与购物', location: '首都国际机场', lat: 40.0799, lng: 116.6031, category: 'transport', estimated_cost_cny: 540, tips: '至少提前2小时到达机场' },
        { time: '17:00', duration_minutes: 210, activity: '北京返程至湛江', location: '返程航班', lat: 21.2144, lng: 110.3589, category: 'transport', estimated_cost_cny: 4900, tips: '落地后建议网约车返家' },
      ],
    },
  ],
  total_estimated_cost_cny: 52380,
  travel_tips: [
    '故宫、国博、热门演出尽量提前预约',
    '市内通勤优先地铁，跨区可打车节省时间',
    '早晚温差明显，建议分层穿搭',
    '预算宽裕可优先选择可退改交通与酒店方案',
  ],
};

function buildDemoResult(taskId: string, sessionId: string): FinalItinerary {
  return {
    ...DEMO_RESULT,
    task_id: taskId,
    session_id: sessionId,
    days: DEMO_RESULT.days.map((day) => ({
      ...day,
      activities: day.activities.map((act, idx) => ({
        ...act,
        // 统一图片源：行程卡片与地图弹窗都读 image_url
        image_url: act.image_url ?? `/map-points/day-${day.day_number}-spot-${idx + 1}.png`,
      })),
    })),
  };
}

interface DemoTaskMeta {
  sessionId: string;
  startedAt: number;
}

const demoTasks = new Map<string, DemoTaskMeta>();

function normalizePrompt(text: string): string {
  return text
    .replace(/[“”"'\s，。,.！!？?（）()]/g, '')
    .trim()
    .toLowerCase();
}

function isFixedDemoPrompt(message: string): boolean {
  const normalized = normalizePrompt(message);
  const hasZhanjiang = normalized.includes('湛江');
  const hasBeijing = normalized.includes('北京');

  // 宽松触发：只要包含「湛江 + 北京」就走演示流程
  // 允许用户自由措辞（例如“从湛江去北京玩7天”“湛江出发北京旅游”等）
  if (hasZhanjiang && hasBeijing) return true;

  return false;
}

function isDemoTask(taskId: string): boolean {
  return taskId.startsWith(DEMO_TASK_PREFIX) && demoTasks.has(taskId);
}

function buildDemoAgents(elapsedMs: number): AgentStatus[] {
  let cursor = elapsedMs;
  return DEMO_STEPS.map((step) => {
    if (cursor <= 0) {
      return {
        agent_name: step.agent_name,
        display_name: step.display_name,
        status: 'pending',
        started_at: null,
        finished_at: null,
        message: '',
        result_summary: '',
        preview_image: null,
      };
    }

    if (cursor < step.duration_ms) {
      return {
        agent_name: step.agent_name,
        display_name: step.display_name,
        status: 'running',
        started_at: new Date(Date.now() - cursor).toISOString(),
        finished_at: null,
        message: step.running_message,
        result_summary: '',
        preview_image: step.preview_image ?? null,
      };
    }

    cursor -= step.duration_ms;
    return {
      agent_name: step.agent_name,
      display_name: step.display_name,
      status: 'done',
      started_at: new Date(Date.now() - elapsedMs).toISOString(),
      finished_at: new Date(Date.now() - cursor).toISOString(),
      message: '',
      result_summary: step.done_summary,
      preview_image: null,
    };
  });
}

// ── Backend Config ───────────────────────────────────────────────────────────
export interface BackendConfig {
  auth_enabled: boolean;
  google_oauth_enabled?: boolean;
  wechat_oauth_enabled?: boolean;
}

export async function fetchBackendConfig(): Promise<BackendConfig> {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error(`获取配置失败 (${res.status})`);
  return res.json();
}

// ── Token Management ────────────────────────────────────────────────────────
const TOKEN_KEY = 'openclaw_tokens';

export interface TokenData {
  access_token: string;
  refresh_token: string;
  user_id: string;
  username: string;
}

export function saveTokens(data: TokenData) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
}

export function getTokens(): TokenData | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const tokens = getTokens();
  return tokens ? { 'Authorization': `Bearer ${tokens.access_token}` } : {};
}

/** Fire a global event so App can redirect to login on 401 */
function handle401(res: Response): boolean {
  if (res.status === 401) {
    clearTokens();
    window.dispatchEvent(new CustomEvent('auth-expired'));
    return true;
  }
  return false;
}

export interface ChatAttachmentPayload {
  name: string;
  mime_type: string;
  data_base64: string;
  size_bytes?: number;
}

export async function postChat(
  message: string,
  sessionId: string,
  taskId?: string,
  itineraryContext?: string,
  attachments?: ChatAttachmentPayload[],
): Promise<ChatResponse> {
  if (isFixedDemoPrompt(message)) {
    const demoTaskId = `${DEMO_TASK_PREFIX}${Date.now()}`;
    demoTasks.set(demoTaskId, { sessionId, startedAt: Date.now() });
    return {
      task_id: demoTaskId,
      session_id: sessionId,
      message: '已进入演示流程',
      status_poll_url: `${API_BASE}/task/${demoTaskId}/status`,
      result_url: `${API_BASE}/task/${demoTaskId}/result`,
      response_type: 'pipeline',
      quick_reply: null,
    };
  }

  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      ...(taskId && { task_id: taskId }),
      ...(itineraryContext && { itinerary_context: itineraryContext }),
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`请求失败 (${res.status}): ${txt}`);
  }
  return res.json();
}

export async function pollStatus(taskId: string): Promise<TaskStatus> {
  if (isDemoTask(taskId)) {
    const meta = demoTasks.get(taskId)!;
    const elapsedMs = Date.now() - meta.startedAt;
    const agents = buildDemoAgents(elapsedMs);
    const completed = agents.filter((a) => a.status === 'done').length;
    const overallDone = elapsedMs >= DEMO_TOTAL_MS;
    const progressPct = overallDone
      ? 100
      : Math.max(6, Math.min(99, Math.round((Math.min(elapsedMs, DEMO_TOTAL_MS) / DEMO_TOTAL_MS) * 100)));

    return {
      task_id: taskId,
      session_id: meta.sessionId,
      overall_status: overallDone ? 'done' : (completed > 0 ? 'running' : 'pending'),
      progress_pct: progressPct,
      agents,
      created_at: new Date(meta.startedAt).toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const res = await fetch(`${API_BASE}/task/${taskId}/status`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`状态查询失败 (${res.status})`);
  }
  return res.json();
}

export async function fetchResult(taskId: string): Promise<FinalItinerary> {
  if (isDemoTask(taskId)) {
    const meta = demoTasks.get(taskId)!;
    return buildDemoResult(taskId, meta.sessionId);
  }

  const res = await fetch(`${API_BASE}/task/${taskId}/result`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`获取结果失败 (${res.status})`);
  }
  return res.json();
}

export async function fetchTasks(): Promise<ItinerarySummary[]> {
  const res = await fetch(`${API_BASE}/tasks`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`获取历史规划失败 (${res.status})`);
  }
  return res.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/task/${taskId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`删除行程失败 (${res.status})`);
  }
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`获取对话列表失败 (${res.status})`);
  }
  return res.json();
}

export async function createConversation(): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`创建对话失败 (${res.status})`);
  }
  return res.json();
}

export async function fetchConversationMessages(convId: string): Promise<ConversationMessage[]> {
  const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`获取对话消息失败 (${res.status})`);
  }
  const data = await res.json();
  return data.messages ?? [];
}

export async function updateConversationTitle(convId: string, title: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/conversations/${convId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`更新对话标题失败 (${res.status})`);
  }
  return res.json();
}

export async function touchConversation(convId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${convId}/touch`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
}

export async function deleteConversation(convId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/${convId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`删除对话失败 (${res.status})`);
  }
}

export interface WalkingRouteResponse {
  segments: [number, number][][];
  ok: boolean;
}

export async function fetchWalkingRoute(
  waypoints: { lat: number; lng: number; name?: string; location?: string; city?: string }[],
): Promise<WalkingRouteResponse> {
  const res = await fetch(`${API_BASE}/route/walking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ waypoints }),
  });
  if (!res.ok) return { segments: [], ok: false };
  return res.json();
}

// ── Auth API ─────────────────────────────────────────────────────────────────

export interface LoginRequest {
  username: string;  // username or email
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user_id: string;
  username: string;
}

export async function login(body: LoginRequest): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`登录失败 (${res.status}): ${txt}`);
  }
  const data: TokenResponse = await res.json();
  saveTokens(data);
  return data;
}

export async function register(body: RegisterRequest): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`注册失败 (${res.status}): ${txt}`);
  }
  const data: TokenResponse = await res.json();
  saveTokens(data);
  return data;
}

export async function refreshToken(): Promise<TokenResponse> {
  const tokens = getTokens();
  if (!tokens) throw new Error('未登录');
  
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) {
    clearTokens();
    throw new Error(`Token 刷新失败 (${res.status})`);
  }
  const data: TokenResponse = await res.json();
  saveTokens(data);
  return data;
}

export interface UserProfile {
  user_id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  auth_provider: string;
  created_at: string;
  is_active: boolean;
}

export async function fetchUserProfile(): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    throw new Error(`获取用户信息失败 (${res.status})`);
  }
  return res.json();
}

export async function updateUserProfile(data: { username?: string; email?: string }): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`更新资料失败 (${res.status}): ${txt}`);
  }
  return res.json();
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`密码修改失败 (${res.status}): ${txt}`);
  }
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (handle401(res)) throw new Error('登录已过期，请重新登录');
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`注销账户失败 (${res.status}): ${txt}`);
  }
}

export function logout() {
  clearTokens();
}
