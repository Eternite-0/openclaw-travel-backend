import {
  Sparkles, Banknote, Calculator, Plane, Hotel, Compass, CloudSun, Route, ShieldCheck,
} from 'lucide-react';
import type { AgentStatus, AgentStyleConfig } from './types';

// Placeholder agent names shown while waiting for first poll
export const AGENT_PLACEHOLDERS: AgentStatus[] = [
  { agent_name: 'intent_parser', display_name: '意图解析', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'currency_agent', display_name: '汇率分析', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'budget_agent', display_name: '预算规划', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'visa_agent', display_name: '签证/入境信息', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'flight_agent', display_name: '航班查询', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'hotel_agent', display_name: '酒店推荐', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'attraction_agent', display_name: '景点规划', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'weather_agent', display_name: '天气预报', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
  { agent_name: 'itinerary_agent', display_name: '行程生成', status: 'pending', started_at: null, finished_at: null, message: '', result_summary: '' },
];

export const AGENT_STYLE: Record<string, AgentStyleConfig> = {
  intent_parser:    { icon: Sparkles,   color: 'text-indigo-500', bg: 'bg-indigo-50',  activeBg: 'bg-indigo-100' },
  currency_agent:   { icon: Banknote,   color: 'text-amber-500',  bg: 'bg-amber-50',   activeBg: 'bg-amber-100' },
  budget_agent:     { icon: Calculator,  color: 'text-emerald-500', bg: 'bg-emerald-50', activeBg: 'bg-emerald-100' },
  visa_agent:       { icon: ShieldCheck, color: 'text-cyan-500',   bg: 'bg-cyan-50',    activeBg: 'bg-cyan-100' },
  flight_agent:     { icon: Plane,      color: 'text-sky-500',    bg: 'bg-sky-50',     activeBg: 'bg-sky-100' },
  hotel_agent:      { icon: Hotel,      color: 'text-rose-500',   bg: 'bg-rose-50',    activeBg: 'bg-rose-100' },
  attraction_agent: { icon: Compass,    color: 'text-violet-500', bg: 'bg-violet-50',  activeBg: 'bg-violet-100' },
  weather_agent:    { icon: CloudSun,   color: 'text-orange-500', bg: 'bg-orange-50',  activeBg: 'bg-orange-100' },
  itinerary_agent:  { icon: Route,      color: 'text-teal-500',   bg: 'bg-teal-50',    activeBg: 'bg-teal-100' },
};

// ── Per-agent cycling status messages ────────────────────────────────────────

export const AGENT_MESSAGES: Record<string, string[]> = {
  intent_parser: [
    '正在理解您的旅行需求...',
    '解析出发地与目的地...',
    '提取预算与出行偏好...',
    '识别特殊行程要求...',
    '整理旅行意图数据...',
  ],
  currency_agent: [
    '获取实时汇率数据...',
    '查询人民币兑换比率...',
    '计算目的地消费水平...',
    '分析近期汇率走势...',
    '生成换汇建议...',
  ],
  budget_agent: [
    '根据预算规划费用分配...',
    '计算交通与住宿占比...',
    '估算餐饮与景点花费...',
    '优化各项支出结构...',
    '生成预算明细报告...',
  ],
  visa_agent: [
    '查询目的地签证政策...',
    '检查免签/落地签条件...',
    '整理所需申请材料...',
    '估算办理费用与时间...',
    '生成入境须知摘要...',
  ],
  flight_agent: [
    '搜索最优出发航班...',
    '比对多家航空公司票价...',
    '分析中转与直飞方案...',
    '筛选性价比最高航班...',
    '核查余票与座位信息...',
  ],
  hotel_agent: [
    '搜索目的地附近酒店...',
    '比对房型价格与设施...',
    '查阅用户真实评分...',
    '筛选高性价比住宿...',
    '确认入住与退房政策...',
  ],
  attraction_agent: [
    '查询目的地热门景点...',
    '分析景点开放时间与票价...',
    '规划最优游览路线...',
    '匹配您的兴趣偏好...',
    '整合景点交通衔接...',
  ],
  weather_agent: [
    '获取目的地天气预报...',
    '分析出行日期气候特征...',
    '生成逐日穿衣建议...',
    '评估天气对行程的影响...',
    '整合气象数据报告...',
  ],
  itinerary_agent: [
    '综合所有数据编排行程...',
    '优化景点与交通衔接...',
    '平衡每日游览节奏...',
    '填充餐饮与休闲安排...',
    '生成最终完整行程方案...',
  ],
};

export const PIXABAY_CAT: Record<string, string> = {
  landmark: 'travel',
  museum: 'buildings',
  nature: 'nature',
  entertainment: 'travel',
  food: 'food',
  transport: 'transportation',
};
