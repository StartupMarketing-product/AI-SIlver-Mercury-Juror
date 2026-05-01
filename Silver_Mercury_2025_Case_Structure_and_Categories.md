# Silver Mercury 2025 — What Was Submitted & Categories

## What was actually submitted as a case

Each **case** (project) in the JSON is one competition entry. Below are the fields that were submitted and how often they are filled (out of **1,718** cases).

### Core description & context (almost always filled)

| Field | Filled | % | Description |
|-------|--------|---|-------------|
| **project_id** | 1,718 | 100% | Unique case ID |
| **project_name** | 1,717 | 99.9% | Case title |
| **project_info** | 1,712 | 99.7% | Short description of the project |
| **project_product** | 1,706 | 99.3% | Product/service |
| **project_auditory** | 1,704 | 99.2% | Target audience |
| **project_insight** | 1,700 | 99.0% | Insight |
| **project_targets** | 1,700 | 99.0% | Goals/targets |
| **project_results** | 1,697 | 98.8% | **Results** (narrative + numbers) |
| **project_size_id** | 1,693 | 98.5% | Project size |
| **project_start_info** | 1,693 | 98.5% | Market/context info |
| **project_task** | 1,682 | 97.9% | Task |
| **project_channels** | 1,672 | 97.3% | Channels used |
| **project_realisation** | 1,670 | 97.2% | How it was executed |
| **project_strategy** | 1,665 | 96.9% | Strategy |
| **project_date_from** | 1,676 | 97.6% | Start date |
| **project_date_to** | 1,401 | 81.5% | End date |

So each case typically includes: **description** (info, product, task, audience, insight), **strategy**, **channels**, **realisation**, and **results** (descriptions and numbers). Results are in text in `project_results` and often backed by a PDF in `project_results_file`.

### Supporting materials (optional)

| Field | Filled | % | Description |
|-------|--------|---|-------------|
| **project_results_file** | 1,420 | 82.7% | PDF with results (URL) |
| **project_video_link** | 1,397 | 81.3% | Video (e.g. Rutube/Vimeo) |
| **project_presentation_pdf** | 843 | 49.1% | Presentation PDF |
| **project_presentation_website** | 517 | 30.1% | Presentation website |
| **project_additional_factors** | 1,001 | 58.3% | Extra factors / context |

### Rarely or never filled

| Field | Filled | % |
|-------|--------|---|
| project_budget | 4 | 0.2% |
| project_big_idea | 0 | 0% |
| project_business_results | 0 | 0% |
| project_call | 0 | 0% |
| project_creative | 0 | 0% |
| project_effectivity | 0 | 0% |
| project_info_client | 0 | 0% |
| project_presentation_video_link | 0 | 0% |
| project_results_text | 0 | 0% |
| project_strategy_idea_or_actuality | 0 | 0% |
| project_unique | 0 | 0% |

**Summary:** Submissions are rich in **descriptions** (info, task, audience, insight, strategy, channels, realisation) and **results** (text + often a results PDF and video). **Numbers** appear mainly inside `project_results` and in the linked `project_results_file`. Budget and formal business/effectivity fields are almost never filled.

---

## How many different categories?

- **169 unique nomination categories** (each has a code and name).
- They are grouped into **12 top-level sections** (blocks).

### Sections and number of nominations

| Section | Nominations | Code range | Theme (first codes) |
|---------|-------------|------------|----------------------|
| 1 | 27 | A01–A27 | Industries (FMCG, retail, pharma, finance, etc.) |
| 2 | 14 | B01–B14 | Branding (new brand, rebranding, craft, etc.) |
| 3 | 15 | C01–C15 | Creative campaigns (innovative, TV/OLV, AI, etc.) |
| 4 | 19 | D01–D19 | Digital (performance, SMM, AI, gamification, etc.) |
| 5 | 14 | E01–E14 | PR (B2C/B2B, territorial, ESG, etc.) |
| 6 | 18 | F01–F18 | Marketing (integrated, promo, sponsorship, etc.) |
| 7 | 9 | G01–G09 | Branded content (media, digital, SMM, etc.) |
| 8 | 13 | H01–H13 | Strategy (new market, scaling, crisis, etc.) |
| 9 | 2 | I01–I02 | Best of (creative solution, sales & value) |
| 10 | 15 | J01–J15 | Advertising (TV/OLV, video, humor, etc.) |
| 11 | 13 | K01–K13 | Events (marketing event, offline/online, etc.) |
| 12 | 10 | L01–L10 | Employer / corporate (employer brand, HR, etc.) |
| **Total** | **169** | | |

So: **169 categories** in **12 sections**. The full list of all 169 categories (code + Russian/English name) is in the script output; the JSON structure is: top level = array of 12 sections, each section = array of nomination objects with `id`, `code`, `name`, `description`, and `projects` (array of cases).

---

*Source: SM_2025.json.*
