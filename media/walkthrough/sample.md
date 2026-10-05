## What you'll see

The sample is a real-shaped `OpportunityTrigger` transaction that goes wrong in several ways at once:

- 🔁 **SOQL-in-loop** — the same Contract query runs 8 times
- 🐌 **Large queries** — 4,562 and 1,523 rows
- 📡 **An external callout**
- 🛑 **A NullPointerException** three frames deep

Open the **Profiler** tab to see which line actually burned the time, then press **🔧 Suggest fix** on the SOQL-in-loop issue.
