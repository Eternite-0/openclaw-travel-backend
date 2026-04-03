from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class TravelIntent(BaseModel):
    origin_city: str
    origin_country: str
    dest_city: str
    dest_country: str
    dest_country_code: str
    departure_date: date
    return_date: date
    duration_days: int
    budget_cny: float
    travelers: int = 1
    travel_style: Literal["budget", "standard", "luxury"] = "standard"
    special_requests: list[str] = []
    change_hints: list[Literal["budget", "hotel", "flight", "itinerary", "dates", "destination", "full"]] = []


class CurrencyInfo(BaseModel):
    from_currency: str
    to_currency: str
    rate: float
    budget_in_dest_currency: float
    tips: list[str]


class BudgetBreakdown(BaseModel):
    total_cny: float
    flight_cny: float
    accommodation_cny: float
    food_cny: float
    transport_cny: float
    attractions_cny: float
    shopping_cny: float
    emergency_cny: float
    daily_budget_cny: float
    notes: str


class FlightOption(BaseModel):
    airline: str
    flight_number: str
    departure_time: datetime
    arrival_time: datetime
    duration_hours: float
    price_cny: float
    stops: int
    booking_tip: str


class FlightResult(BaseModel):
    outbound: list[FlightOption]
    return_flights: list[FlightOption]
    recommended_index: int


class HotelOption(BaseModel):
    name: str
    stars: int
    area: str
    price_per_night_cny: float
    total_price_cny: float
    highlights: list[str]
    booking_tip: str


class HotelResult(BaseModel):
    options: list[HotelOption]
    recommended_index: int


class Attraction(BaseModel):
    name: str
    name_zh: str
    category: Literal["landmark", "museum", "nature", "entertainment", "food"]
    address: str
    opening_hours: str
    entry_fee_cny: float
    recommended_duration_hours: float
    tips: str
    must_see: bool


class AttractionResult(BaseModel):
    attractions: list[Attraction]


class DayWeather(BaseModel):
    date: date
    condition: str
    temp_high_c: float
    temp_low_c: float
    precipitation_mm: float
    clothing_advice: str


class WeatherResult(BaseModel):
    daily: list[DayWeather]
    overall_summary: str
    packing_suggestions: list[str]


class ItineraryActivity(BaseModel):
    time: str
    duration_minutes: int
    activity: str
    location: str
    category: str
    estimated_cost_cny: float
    tips: str


class ItineraryDay(BaseModel):
    day_number: int
    date: date
    theme: str
    weather_summary: str
    activities: list[ItineraryActivity]
    meals: dict[str, str]
    transport_notes: str
    daily_budget_cny: float


class FinalItinerary(BaseModel):
    task_id: str
    session_id: str
    created_at: datetime
    intent: TravelIntent
    currency: CurrencyInfo
    budget: BudgetBreakdown
    recommended_flight: FlightOption
    recommended_hotel: HotelOption
    weather: WeatherResult
    highlights: list[str]
    days: list[ItineraryDay]
    total_estimated_cost_cny: float
    travel_tips: list[str]
    emergency_contacts: dict[str, str]


class AgentStatus(BaseModel):
    agent_name: str
    display_name: str
    status: Literal["pending", "running", "done", "error"]
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    message: str = ""
    result_summary: str = ""


class TaskStatus(BaseModel):
    task_id: str
    session_id: str
    overall_status: Literal["pending", "running", "done", "error"]
    progress_pct: int = Field(ge=0, le=100)
    agents: list[AgentStatus]
    created_at: datetime
    updated_at: datetime


class ChatRequest(BaseModel):
    message: str
    session_id: str
    task_id: Optional[str] = None
    itinerary_context: Optional[str] = None


class ChatResponse(BaseModel):
    task_id: Optional[str] = None
    session_id: str
    message: str
    status_poll_url: Optional[str] = None
    result_url: Optional[str] = None
    response_type: Literal["quick", "pipeline"] = "pipeline"
    quick_reply: Optional[str] = None


class HistoryResponse(BaseModel):
    session_id: str
    messages: list[dict]


class ClearResponse(BaseModel):
    cleared: bool


class HealthResponse(BaseModel):
    status: str
    redis: str
    version: str


class ItinerarySummary(BaseModel):
    task_id: str
    session_id: str
    created_at: datetime
    origin_city: str
    dest_city: str
    duration_days: int
    budget_cny: float
    status: str
