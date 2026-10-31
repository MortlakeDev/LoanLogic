# LoanLogic — Financial glossary (en / zh-CN / ru / uk)

Status: v1.0 · Normative for UI strings, exports and help texts. Translators and the
implementer use these terms; anything not listed follows the style rules in §1. A native
speaker reviews zh-CN, ru and uk before v1.0 (PLAN §10); proposed changes go through a PR
to this file.

## 1. Style rules per language

| Language | Rules |
|---|---|
| en | US spelling ("amortization"); sentence case; "loan" for the product, "credit" only in fixed terms ("cost of credit"); regulatory abbreviations unexpanded in labels (APR, APRC) and expanded in help. |
| zh-CN | 贷款 for "loan" (not 借款); a space between Han characters and Latin letters or digits in translated strings ("共 360 期", "年化利率 3.10%"; text produced by Intl formatters is used as returned); full-width punctuation in sentences (，。：；（）); currency symbol ¥ with CNY; 期 for a payment number ("第 1 期"). |
| ru | ё is written ("платёж"); «ёлочки» quotes; «Переплата» for the total cost of credit, ПСК only for the Russian rate method; «проценты» for interest amounts, «процентная ставка» for the rate; no anglicisms where a Russian term exists, except APR, APRC, LTV, DSCR. |
| uk | Apostrophe U+2019 (’) — «з’являться»; terms of the Law "On Consumer Credit" and NBU rules: «кредитодавець», «загальні витрати за кредитом», «загальна вартість кредиту», «реальна річна процентна ставка», «строк кредиту»; «проценти» for interest amounts, «процентна ставка» for the rate. |

## 2. Loan basics

| Key idea | en | zh-CN | ru | uk |
|---|---|---|---|---|
| loan | Loan | 贷款 | Кредит | Кредит |
| loan amount | Loan amount | 贷款金额 | Сумма кредита | Сума кредиту |
| principal (column, part of a payment) | Principal | 本金 | Основной долг | Основний борг |
| outstanding balance | Balance | 剩余本金 | Остаток долга | Залишок заборгованості |
| interest (amount) | Interest | 利息 | Проценты | Проценти |
| interest rate | Interest rate | 年利率 | Процентная ставка | Процентна ставка |
| nominal annual rate (hint) | Nominal, per year | 名义年利率 | Номинальная, годовых | Номінальна, річних |
| contract rate | Contract rate | 合同利率 | Ставка по договору | Ставка за договором |
| payment / instalment | Payment | 每期还款额 | Платёж | Платіж |
| monthly payment | Monthly payment | 月供 | Ежемесячный платёж | Щомісячний платіж |
| weekly / bi-weekly / quarterly / semi-annual / annual payment | Weekly payment … | 每周还款额 / 每两周还款额 / 每季度还款额 / 每半年还款额 / 每年还款额 | Еженедельный платёж / Платёж раз в две недели / Ежеквартальный платёж / Платёж раз в полгода / Ежегодный платёж | Щотижневий платіж / Платіж раз на два тижні / Щоквартальний платіж / Платіж раз на пів року / Щорічний платіж |
| first / last payment | First payment / Final payment | 首期还款额 / 末期还款额 | Первый платёж / Последний платёж | Перший платіж / Останній платіж |
| term | Term | 贷款期限 | Срок кредита | Строк кредиту |
| years / months (input units) | yr / mo | 年 / 个月 | г. / мес. | р. / міс. |
| number of payments | Payments | 还款期数 | Количество платежей | Кількість платежів |
| payment number | No. 1 | 第 1 期 | Платёж № 1 | Платіж № 1 |
| payment frequency | Payment frequency | 还款频率 | Периодичность платежей | Періодичність платежів |
| weekly … annual (frequency) | Weekly · Bi-weekly · Monthly · Quarterly · Semi-annual · Annual | 每周 · 每两周 · 每月 · 每季度 · 每半年 · 每年 | Еженедельно · Раз в две недели · Ежемесячно · Ежеквартально · Раз в полгода · Ежегодно | Щотижня · Раз на два тижні · Щомісяця · Щокварталу · Раз на пів року · Щороку |
| disbursement date | Disbursement date | 放款日期 | Дата выдачи | Дата видачі |
| first payment date | First payment date | 首次还款日 | Дата первого платежа | Дата першого платежу |
| payoff date | Paid off | 还清日期 | Дата полного погашения | Дата повного погашення |
| payment schedule | Payment schedule | 还款计划 | График платежей | Графік платежів |
| lender | Lender | 贷款机构 | Кредитор | Кредитодавець |
| borrower | Borrower | 借款人 | Заёмщик | Позичальник |

## 3. Repayment types

| Key idea | en | zh-CN | ru | uk |
|---|---|---|---|---|
| repayment type | Repayment | 还款方式 | Способ погашения | Спосіб погашення |
| annuity | Equal payments | 等额本息 | Аннуитетный | Ануїтетний |
| annuity (description) | Same amount every period | 每期还款额相同 | Одинаковый платёж каждый период | Однаковий платіж щоперіоду |
| equal principal | Equal principal | 等额本金 | Дифференцированный | Диференційований |
| equal principal (description) | Payments go down | 每期还款额递减 | Платёж уменьшается | Платіж зменшується |
| interest-only + bullet | Interest-only | 先息后本 | Только проценты | Лише проценти |
| interest-only (description) | Principal at the end | 到期一次还本 | Основной долг в конце срока | Основний борг наприкінці строку |
| balloon | Balloon | 气球贷 | С остаточным платежом | Із залишковим платежем |
| balloon (description) | Lower payments, final lump sum | 尾款一次性偿还 | Меньшие платежи и крупный платёж в конце | Менші платежі й великий платіж наприкінці |
| balloon payment (amount) | Balloon payment | 尾款 | Остаточный платёж | Залишковий платіж |

## 4. Fees and insurance

| Key idea | en | zh-CN | ru | uk |
|---|---|---|---|---|
| fee | Fee | 费用 | Комиссия | Комісія |
| fees and insurance (section) | Fees & insurance | 费用与保险 | Комиссии и страховка | Комісії та страхування |
| upfront / origination fee | Origination fee | 贷款手续费 | Комиссия за выдачу | Комісія за видачу |
| paid at closing | Paid at closing | 放款时支付 | Оплачивается при выдаче | Сплачується при видачі |
| financed | Added to the loan | 计入贷款本金 | Включена в сумму кредита | Включена в суму кредиту |
| periodic fee (charged every payment period, SPEC §6.2) | Periodic fee | 每期服务费 | Комиссия за период | Комісія за період |
| % of the original amount | % of the loan amount | 按贷款金额的 % | % от суммы кредита | % від суми кредиту |
| % of the outstanding balance | % of the balance | 按剩余本金的 % | % от остатка долга | % від залишку заборгованості |
| insurance | Insurance | 保险费 | Страховка | Страхування |
| included in the headline rate | In {rateName} (In APR, In APRC, …) | 计入{rateName} | Входит в расчёт ставки | Враховується у ставці |

## 5. Cost-of-credit figures

| Key idea | en | zh-CN | ru | uk |
|---|---|---|---|---|
| total interest | Total interest | 利息总额 | Сумма процентов | Сума процентів |
| total cost of credit (interest + fees + insurance) | Total cost of credit | 贷款总成本 | Переплата | Загальні витрати за кредитом |
| total of payments (`totalPayments`) | Total of payments | 还款总额 | Общая сумма выплат | Сума всіх платежів |
| total paid (`totalPaid`: payments + fees paid at closing) | Total paid | 支付总额 | Всего выплачено | Загальна вартість кредиту |
| repaid per unit borrowed (template) | You repay {ratio} for every {one} borrowed | 每借 {one}，需还 {ratio} | Вы вернёте {ratio} на {one} кредита | Ви повернете {ratio} на {one} кредиту |
| amount financed (US) | Amount financed | 实际融资金额 | Фактически полученная сумма | Фактично отримана сума |
| net proceeds | Net amount received | 实际到手金额 | Сумма на руки | Сума до видачі |
| how it is calculated | How it's calculated | 计算方法 | Как рассчитано | Як розраховано |

## 6. Rates (regional methods)

Method names are proper terms; the badge shows the source (SPEC §9.3).

| Method id | en | zh-CN | ru | uk |
|---|---|---|---|---|
| `usRegZApr` | APR | 年度百分率 APR（美国） | Годовая ставка APR (США) | Річна ставка APR (США) |
| `ukAprc` (consumer credit, CONC App 1.2) | APR | 年度百分率 APR（英国） | APR (Великобритания) | APR (Велика Британія) |
| `ukAprc` (mortgage presets, MCOB 10A) | APRC | 综合年化成本率 APRC（英国） | APRC (Великобритания, ипотека) | APRC (Велика Британія, іпотека) |
| `euAprc` | APRC | 综合年化成本率 APRC（欧盟） | APRC (ЕС) | APRC (ЄС) |
| `cnAnnualized` | Annualized rate (simple) | 年化利率（单利） | Годовая ставка (простые проценты, методика НБК) | Річна ставка (прості проценти, методика НБК) |
| `irrEffective` (CN label) | Annualized rate (compound, IRR) | 年化利率（复利，IRR 法） | Годовая ставка (сложные проценты, IRR) | Річна ставка (складні проценти, IRR) |
| `irrNominal` | Nominal IRR (r × m) | 名义内部收益率（r × m） | Номинальная годовая IRR (r × m) | Номінальна річна IRR (r × m) |
| `uaRealAnnual` | Real annual interest rate | 真实年利率（乌克兰） | Реальная годовая процентная ставка | Реальна річна процентна ставка |
| `international` | Effective all-in rate | 综合实际年利率 | Эффективная ставка с учётом всех расходов | Ефективна ставка з усіма витратами |
| RU ПСК (M4) | Full cost of credit (ПСК) | 全部信贷成本 ПСК（俄罗斯） | Полная стоимость кредита (ПСК) | Повна вартість кредиту (ПСК, Росія) |
| `effective` (other profiles' secondary rate, without fees) | Effective rate (without fees) | 有效年利率（不含费用） | Эффективная ставка (без комиссий) | Ефективна ставка (без комісій) |
| `nominal` | Nominal rate | 名义年利率 | Номинальная ставка | Номінальна ставка |
| `xirr` | XIRR | XIRR | XIRR | XIRR |

## 7. Interest model and settings

| Key idea | en | zh-CN | ru | uk |
|---|---|---|---|---|
| advanced settings | Advanced | 高级设置 | Дополнительно | Додатково |
| compounding | Compounding | 复利频率 | Капитализация процентов | Капіталізація процентів |
| periodic (accrual) | Per period | 按期计息 | По периодам | За періодами |
| day-count convention | Day count | 计息基准 | База начисления (метод подсчёта дней) | База нарахування (метод підрахунку днів) |
| payment basis nominal / exact | Bank practice / Exact amortization | 银行惯例 / 精确摊还 | Как в банке / Точная амортизация | Як у банку / Точна амортизація |
| rounding | Rounding | 舍入方式 | Округление | Округлення |
| half-up / half-even / up / down | Half up / Half to even / Up / Down | 四舍五入 / 银行家舍入 / 向上舍入 / 向下舍入 | Математическое / Банковское / Вверх / Вниз | Математичне / Банківське / Вгору / Вниз |
| end-of-month rule | Pay on the last day of the month | 每月最后一天还款 | Платить в последний день месяца | Платити в останній день місяця |
| reconciles to the cent | Every row reconciles to the cent | 每期数据精确到分 | Каждая строка сходится до копейки | Кожен рядок сходиться до копійки |

## 8. Events, analysis, affordability (M3–M5)

| Key idea | en | zh-CN | ru | uk |
|---|---|---|---|---|
| prepayment | Prepayment | 提前还款 | Досрочное погашение | Дострокове погашення |
| reduce term / reduce payment | Shorten the term / Lower the payment | 缩短期限 / 减少月供 | Сократить срок / Уменьшить платёж | Скоротити строк / Зменшити платіж |
| early repayment charge | Early repayment charge | 提前还款违约金 | Комиссия за досрочное погашение | Комісія за дострокове погашення |
| rate change | Rate change | 利率调整 | Изменение ставки | Зміна ставки |
| payment holiday | Payment holiday | 延期还款 | Кредитные каникулы | Кредитні канікули |
| refinance | Refinance | 转贷 | Рефинансирование | Рефінансування |
| payoff amount | Payoff amount | 提前结清金额 | Сумма для полного погашения | Сума для повного погашення |
| compare offers | Compare offers | 比较贷款方案 | Сравнить предложения | Порівняти пропозиції |
| debt-to-income | DTI (debt-to-income) | 负债收入比 | ПДН (показатель долговой нагрузки) | Боргове навантаження (DTI) |
| loan-to-value | LTV (loan-to-value) | 贷款价值比 LTV | LTV (кредит к стоимости залога) | LTV (кредит до вартості застави) |
| DSCR | DSCR | 偿债覆盖率 DSCR | DSCR (покрытие долга) | DSCR (покриття боргу) |
| deposit | Deposit | 存款 | Вклад | Депозит |
| capitalization (deposit) | Interest added to the balance | 利息转存（复利） | Капитализация процентов | Капіталізація процентів |

## 9. Words to avoid

| Language | Avoid | Use instead | Why |
|---|---|---|---|
| en | "APR" for an effective rate | APR only for Reg Z and the UK APR; "effective rate" otherwise | an effective rate labelled APR misled users in the old app |
| zh-CN | 借款 for the product | 贷款 | 借款 is the borrower's act; banks name the product 贷款 |
| ru | ПСК for anything but the Russian method | Переплата (amount); «ставка с учётом всех расходов» (rate) | ПСК is a legal term of 353-FZ; «эффективная ставка» alone is the rate without fees |
| uk | «загальна вартість кредиту» for the cost or for the total of payments | «загальні витрати за кредитом» (cost); «сума всіх платежів» (`totalPayments`) | in the law the first means the amount plus all costs, i.e. `totalPaid` |
| uk | «тіло кредиту» | «основний борг» | jargon |
| zh-CN | 年化利率 without 单利 for `r × m` | 年化利率（单利） | PBOC [2021] No. 3: a simple-interest figure must say so |
| uk | «термін кредиту» | «строк кредиту» | «строк» is the legal term for a period |
