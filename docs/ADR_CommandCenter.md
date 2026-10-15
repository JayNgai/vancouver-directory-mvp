# 🏛️ Architectural Blueprint: Existing Command Center (localhost:4100)
## System Overview
The Command Center functions as a centralized, read-only dashboard and basic management portal for the directory's core data assets. It is built to display current status and facilitate simple administrative tasks based on existing database records.

**Primary Purpose:** Status monitoring, manual intervention logging, and historical reporting.
**Technology Base:** Node/Express/Nunjucks, relying heavily on read-only interactions with Prisma/SQLite schema.

## 📋 Core Features & Modules
1.  **Directory Listing Viewer:** Displays all basic data points (Name, Category, Location) pulled from the primary directory tables.
2.  **Status Viewer:** Shows simple status flags based on pre-set criteria (e.g., 'Is Featured: TRUE', 'Needs Review'). This is largely a read-only view of boolean/enum fields.
3.  **Audit Log Viewer:** Displays historical records of actions taken (`Event` table), useful for knowing *what happened*.

## ⚠️ Architectural Limitations (The Gaps)
*   **State Detection:** Poor ability to track *in-flight processes*. If a workflow is triggered but pauses halfway, the dashboard only shows "Last Updated: X time," not "Status: Awaiting Payment Confirmation."
*   **Trigger Mechanism:** Primarily **Polling/Pull**. Requires manual checks or scheduled jobs to detect state changes.
*   **Write Authority:** Write capabilities are highly constrained and primarily limited to administrative status flips (e.g., `admin_approve(id)`).

## 🎯 Architectural Diagram Concept
[Diagram Placeholder: Simple flow diagram showing User $\rightarrow$ Web/Client $\rightarrow$ Read-Only API Gateway $\rightarrow$ Database.]