# Sample Knowledge Base — NorthPeak Heating & Air

Paste the **KB content** section into **SDR Agent → Knowledge Base**, then **Save Configuration** so it embeds for live-call RAG.

Pairs with: `prompts/northpeak-hvac-sales-agent.md` (agent name: **Aria**)

---

## KB content (copy below)

```
COMPANY
Name: NorthPeak Heating & Air
Type: Residential HVAC (heating, cooling, heat pumps)
HQ / market: Denver metro, Colorado
Phone (main): (303) 555-0148
Website: www.northpeakhvac.example
Hours: Mon–Sat 7:00 AM – 7:00 PM MT; emergency line nights/Sundays for no-heat / no-cool
License: Colorado licensed & insured residential HVAC contractor
Promise: Clear written estimate before work starts. No surprise invoices.

MISSION
Keep Denver homes comfortable year-round with honest diagnostics, fair pricing, and same-week scheduling when capacity allows.

SERVICES
- Air conditioning repair and replacement
- Furnace repair and replacement
- Heat pump install and service
- Ductless mini-split systems
- Seasonal tune-ups / maintenance plans
- Free in-home estimates for repair or replacement decisions
- Thermostat upgrades (including common smart thermostats)
- Air quality add-ons: filters, UV lights, humidifiers (when appropriate)

SERVICE AREA
Primary: Denver, Aurora, Lakewood, Littleton, Englewood, Centennial, Arvada, Westminster, Thornton
Typically within ~35 miles of central Denver. Outside that area: take a message for callback from dispatch.

WHO WE HELP
Homeowners. Renters: politely ask them to have the property owner or property manager schedule.

PRICE GUIDANCE (ranges only — never guarantee a final price on the phone)
- Service / diagnostic visit: often waived with approved repair; otherwise typically $89–$129
- Seasonal AC or furnace tune-up: typically $129–$189
- Common AC repair parts/labor: often $250–$900 depending on part
- Full AC replacement (typical single-family home): commonly $5,500–$12,000+ depending on size/efficiency
- Furnace replacement: commonly $4,000–$9,500+ depending on size/efficiency
- Heat pump systems: quote at estimate — equipment and electrical can vary widely
Always say: final price is confirmed after on-site inspection in a written estimate.

FINANCING
Partner financing options available for qualified homeowners on larger repairs and replacements. Don’t quote APR or approval odds — estimate appointment covers options.

SCHEDULING
- Free 30-minute in-home estimate / diagnostic consult
- Goal: same-week slots when available
- Tech windows: morning (8–12) or afternoon (12–5) Mountain Time
- Collect: full name, mobile phone, service address, brief issue description, preferred window
- If calendar tools are available, check real availability before offering times

WHAT TO SAY ABOUT THE BRAND
- Local Denver crew, not a national call center divert
- We explain findings in plain English
- Written estimate before any paid work beyond the visit agreement
- Aria is the AI receptionist for NorthPeak — be honest if asked if you’re AI

COMMON ISSUES WE HEAR
- AC blows warm air
- Furnace won’t ignite / house cold
- High energy bills
- Loud outdoor unit or buzzing contactor
- System 12–20+ years old; considering replacement
- New homeowner wants a safety / efficiency check

FAQs
Q: Do you charge for estimates?
A: Replacement and most repair decision visits are free estimates. A diagnostic fee may apply for some service calls and is often credited if they approve the repair.

Q: How soon can someone come out?
A: Often within the same week; emergency no-heat/no-cool is prioritized during season. Confirm with live availability when booking.

Q: Do you service apartments?
A: We focus on residential homes and townhomes. For apartments, the property manager usually must authorize work.

Q: Are you the manufacturer?
A: No — we service and install major residential brands. We recommend equipment that fits the home, not a single brand pitch.

Q: Can you give me an exact price now?
A: Not honestly over the phone — load, ductwork, electrical, and unit condition change the number. The free on-site estimate locks it in writing.

Q: Do you sell maintenance plans?
A: Yes — seasonal tune-up plans for AC and heat so systems stay efficient and under warranty where applicable.

OBJECTIONS / SHORT ANSWERS
- Already have a company: Offer a free second-opinion estimate, no pressure.
- Just shopping prices: Happy to put real numbers on paper after a quick visit.
- Too expensive fear: Share typical ranges, then emphasize written estimate and financing options.
- Send info only: Confirm best email/text, still offer to hold a short estimate slot.

COMPLIANCE / DO NOT SAY
- No lifetime guarantees or “you’ll cut your bill in half” claims
- No pressure tactics or fake scarcity (“last slot today” unless calendar shows it)
- If they say remove me / don’t call: apologize, confirm, and end the call
- Don’t invent technician names, permits, or city rebates you’re unsure of

CALL GOAL REMINDER FOR RETRIEVAL
Primary outcome: book a free 30-minute in-home estimate with Aria guiding the homeowner to a confirmed time.
```

---

## Tips

1. Paste into **Knowledge Base**, then **Save** (triggers embedding).
2. Keep the system prompt and KB facts consistent (company name, area, free estimate).
3. Update prices seasonally — ranges age quickly.
4. After editing KB text, save again so RAG rebuilds.
