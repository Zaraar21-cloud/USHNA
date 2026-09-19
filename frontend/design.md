# Design Analysis: Cap Table Dashboard

This document details the UI/UX design of the provided "cake." platform dashboard image.

## Overview
The design is a web-based dashboard for managing equity, specifically a "Cap Table". It features a clean, modern interface with a light color scheme, utilizing white backgrounds, light grey borders, and specific accent colors (primarily purple and pink).

## 1. Top Navigation Bar
The top nav is a white bar spanning the full width, containing:
- **Left:**
  - `cake.` logo (bold, lowercase, with a period).
  - Organization selector dropdown displaying a green avatar "R" and the text "Refero".
- **Middle:**
  - A progress indicator "Let's get started 33%" with a progress bar and a dropdown arrow.
- **Right:**
  - Icons for "Help" (?) and "Notifications" (bell).
  - "Invite co-pilots" action with an add user icon.
  - An "Upgrade" button in a solid bright purple pill shape.
  - "Company Portal" link/button.
  - User profile avatar with initials "LR" in a yellow circle.

## 2. Left Sidebar Navigation
A vertical sidebar on the left provides navigation through the app:
- **Menu Items:**
  - Dashboard
  - People (features a small blue "NEW" badge)
  - Ownership (currently expanded)
    - Cap Table (Highlighted with a light purple background and a thick purple left border indicating the active page)
    - Share classes
    - Transfers
    - Transactions log
    - Valuations
  - Incentive plans (with right chevron indicating a submenu)
  - Tools (with right chevron)
  - Communication
  - Documents (with right chevron)
  - Company (with right chevron)
- **Footer:** A subtle version number "version: 7dff5073" is located at the bottom left.

## 3. Main Content Area: Header & Tabs
- **Page Title:** A large, prominent heading "Cap Table".
- **Tabs:** Navigation within the Cap Table section:
  - Overview (Active, indicated by a thick black underline)
  - Shareholders
  - Option holders (Appears slightly grayed out/disabled)
  - Noteholders

## 4. Main Content Area: Summary Section ("Refero cap table")
This section contains three prominent cards for high-level data:
- **Header:** Title "Refero cap table" with an avatar. On the right, a toggle switch for "Fully diluted" vs. "Undiluted", and a "Download" link.
- **Cards (White background, soft rounded corners, light grey borders):**
  - **Quick stats:** A vertical list of four metrics with icons:
    - Stakeholders: 4
    - Total shares: 6,940
    - Total securities: 6,940
    - Share price: - (dash)
  - **Total securities:**
    - Visualized by a solid pink circle.
    - Displays breakdown: "Ordinary shares" (100%, 6,940 securities) with a pink progress bar.
    - Also lists "Notes" (€13,000.00 invested).
  - **Top shareholders:**
    - Includes a dropdown to select view (e.g., "Top 10 shareholders").
    - Visualized by a donut chart with four segments (pink, light green, orange, yellow).
    - Lists the top 4 shareholders with their percentage, total securities, and a colored bar matching the chart:
      - John Doe (57.63%, pink)
      - Liam Basil (29.1%, light green)
      - Lidiya R (11.81%, orange)
      - John Smith (1.44%, yellow)

## 5. Main Content Area: Owners Table
A detailed data table at the bottom of the page.
- **Header:**
  - Title: "Owners"
  - Right side: A search bar with a magnifying glass icon, and a solid purple "Add" button with a plus icon.
- **Table Columns:**
  - Stakeholder (includes a colored circle with a checkmark, an avatar with initials, and the name. Icons for edit and add are visible on hover/inline).
  - ORD shares
  - Unvested ORD shares
  - CON investment
  - Total securities
  - Total value
  - Ownership (%)
- **Table Data:** Lists the stakeholders matching the "Top shareholders" card, with detailed numerical data across the columns.

## 6. Footer
Small, light gray text at the very bottom containing a legal disclaimer and links to "Terms of use" and "Privacy policy".

## Color Palette Summary
- **Backgrounds:** White, very light gray/off-white for active sidebar items.
- **Text:** Dark gray/black for primary text, medium gray for secondary text/labels.
- **Accents:**
  - Primary Action/Brand: Bright Purple (Upgrade button, Add button, active sidebar indicator).
  - Data Visualization: Pink (dominant), Light Green, Orange, Yellow.
  - Avatars: Various pastel colors (Green, Yellow, Orange, Blue).
