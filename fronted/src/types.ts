import type { LucideIcon } from 'lucide-react';

// ── API Types ──────────────────────────────────────────────────────────────

export interface AgentStatus {
  agent_name: string;
  display_name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  started_at: string | null;
  finished_at: string | null;
  message: string;
  result_summary: string;
}

export interface TaskStatus {
  task_id: string;
  session_id: string;
  overall_status: 'pending' | 'running' | 'done' | 'error';
  progress_pct: number;
  agents: AgentStatus[];
  created_at: string;
  updated_at: string;
}

export interface ChatResponse {
  task_id: string | null;
  session_id: string;
  message: string;
  status_poll_url: string | null;
  result_url: string | null;
  response_type: 'quick' | 'pipeline';
  quick_reply: string | null;
}

export interface FlightOption {
  airline: string;
  flight_number: string;
  departure_time: string;
  arrival_time: string;
  duration_hours: number;
  price_cny: number;
  stops: number;
  booking_tip: string;
}

export interface HotelOption {
  name: string;
  stars: number;
  area: string;
  price_per_night_cny: number;
  total_price_cny: number;
  highlights: string[];
  booking_tip: string;
}

export interface ItineraryActivity {
  time: string;
  duration_minutes: number;
  activity: string;
  location: string;
  category: string;
  estimated_cost_cny: number;
  tips: string;
}

export interface ItineraryDay {
  day_number: number;
  date: string;
  theme: string;
  weather_summary: string;
  activities: ItineraryActivity[];
  meals: Record<string, string>;
  transport_notes: string;
  daily_budget_cny: number;
}

export interface DayWeather {
  date: string;
  condition: string;
  temp_high_c: number;
  temp_low_c: number;
  precipitation_mm: number;
  clothing_advice: string;
}

export interface TravelIntent {
  origin_city: string;
  dest_city: string;
  dest_country: string;
  departure_date: string;
  return_date: string;
  duration_days: number;
  budget_cny: number;
  travelers: number;
  travel_style: string;
}

export interface ItinerarySummary {
  task_id: string;
  session_id: string;
  created_at: string;
  origin_city: string;
  dest_city: string;
  duration_days: number;
  budget_cny: number;
  status: string;
}

export interface FinalItinerary {
  task_id: string;
  session_id: string;
  intent: TravelIntent;
  budget: { total_cny: number; flight_cny: number; accommodation_cny: number; food_cny: number };
  recommended_flight: FlightOption;
  recommended_hotel: HotelOption;
  weather: { daily: DayWeather[]; overall_summary: string; packing_suggestions: string[] };
  highlights: string[];
  days: ItineraryDay[];
  total_estimated_cost_cny: number;
  travel_tips: string[];
}

export interface RunningTask {
  taskId: string;
  query: string;
  startedAt: string;
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  attachments?: Array<{
    name: string;
    kind: 'image' | 'file';
    data_url?: string;
  }>;
  type?: 'replanning' | 'confirm';
  pendingResult?: FinalItinerary;
  confirmed?: 'accepted' | 'dismissed';
}

export interface AgentStyleConfig {
  icon: LucideIcon;
  color: string;
  bg: string;
  activeBg: string;
}

export interface Conversation {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: Array<{
    name: string;
    kind?: 'image' | 'file';
    mime_type?: string;
    data_base64?: string;
    size_bytes?: number;
  }>;
}
