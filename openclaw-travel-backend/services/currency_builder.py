"""Deterministic currency info builder — replaces CurrencyAgent LLM call."""
from __future__ import annotations

from core.schemas import CurrencyInfo, TravelIntent

# Country-specific currency tips templates
_TIPS_BY_COUNTRY: dict[str, list[str]] = {
    "US": [
        "美国大部分场所接受信用卡（Visa/Mastercard），建议携带一张芯片卡",
        "小费文化盛行，餐厅一般给15-20%小费，出租车10-15%",
        "建议在国内银行换少量美元现金备用，大额消费刷卡更划算",
    ],
    "JP": [
        "日本是现金社会，许多小店和餐厅不接受信用卡，建议多备现金",
        "7-11、全家便利店的ATM可用银联卡取日元，手续费较低",
        "日本没有小费文化，不需要额外给小费",
    ],
    "GB": [
        "英国普遍接受非接触式支付和信用卡，现金需求较少",
        "餐厅账单通常已含服务费，无需额外小费；未含时可给10-12.5%",
        "建议使用支持外币交易免手续费的信用卡",
    ],
    "KR": [
        "韩国电子支付非常普及，T-money交通卡可在便利店和地铁使用",
        "明洞等旅游区可使用支付宝/微信支付，但建议备少量韩元现金",
        "韩国没有小费文化，不需要给小费",
    ],
    "TH": [
        "泰国大城市可刷卡，但夜市和小摊需要现金，建议兑换适量泰铢",
        "曼谷有很多换汇点，Super Rich汇率较好，比机场更划算",
        "泰国一般不需要小费，高档餐厅可给20-50泰铢",
    ],
    "SG": [
        "新加坡几乎所有场所都接受信用卡和电子支付，现金需求极少",
        "小贩中心等平价餐饮可能只收现金，建议备少量新加坡元",
        "不需要小费，但高档餐厅账单可能已含10%服务费",
    ],
    "AU": [
        "澳洲普遍使用非接触式支付（tap & go），现金需求很少",
        "建议办一张免外币手续费的信用卡，比换现金更划算",
        "餐厅无强制小费，但可在满意时凑整或给10%",
    ],
    "FR": [
        "法国普遍接受信用卡（需芯片+PIN码），但小咖啡馆可能设最低消费",
        "餐厅账单已含服务费，无需额外给小费，满意可留1-2欧元零钱",
        "建议在国内银行兑换少量欧元现金，用于小额消费",
    ],
    "DE": [
        "德国现金使用比例较高，很多餐厅和小店不接受信用卡",
        "建议携带足够欧元现金，EC卡（借记卡）比信用卡接受度更高",
        "餐厅一般凑整给小费即可，通常5-10%",
    ],
    "IT": [
        "意大利主要城市可刷卡，但小镇和市场可能需要现金",
        "意大利法律要求消费者保留收据，离店前请保留好",
        "餐厅账单通常含服务费(coperto)，无需额外小费",
    ],
}

_DEFAULT_TIPS = [
    "建议提前在国内银行兑换少量当地货币现金，大额消费使用信用卡",
    "选择免外币交易手续费的信用卡可以节省汇率差价",
    "出发前确认银行卡已开通境外交易功能，并通知银行出行计划",
    "保留少量小面额纸币和硬币，用于小费、自动售货机和公共交通",
    "关注汇率波动，可以考虑分批换汇以降低风险",
]


def build_currency_info(
    intent: TravelIntent,
    rate: float,
    to_currency: str,
) -> CurrencyInfo:
    """Build CurrencyInfo deterministically without LLM."""
    budget_in_dest = intent.budget_cny * rate
    tips = _TIPS_BY_COUNTRY.get(intent.dest_country_code, _DEFAULT_TIPS)
    return CurrencyInfo(
        from_currency="CNY",
        to_currency=to_currency,
        rate=round(rate, 6),
        budget_in_dest_currency=round(budget_in_dest, 2),
        tips=tips,
    )
