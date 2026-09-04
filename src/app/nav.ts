import {
  IconUserSearch, IconBriefcase, IconBuildingBank, IconArrowsDiff, IconReportAnalytics,
  IconInfoCircle, IconListSearch, type Icon,
} from '@tabler/icons-react';

export interface NavItem {
  label: string;
  to: string;
  icon: Icon;
}

// Destinations, not instructions. These read as query verbs — "Search Person's Salary", "General
// Comparisons" — which describe what the software does rather than what the visitor is looking at, and
// the longest of them ("Compare People, Titles & Schools") wrapped to two lines in the sidebar. A nav
// label's job is to name the place it goes; the page's own description says what you can do there.
//
// Each label is also the h1 of the page it opens, so arriving somewhere confirms the link you clicked.
//
// This list lives in its own module because two things render it now — the sidebar and the command
// palette — and a destination that exists in one but not the other is a place you can only reach by
// mouse, or only by keyboard.
export const NAV: NavItem[] = [
  { label: 'People', to: '/', icon: IconUserSearch },
  { label: 'Titles', to: '/paycheck', icon: IconBriefcase },
  { label: 'Divisions', to: '/explore', icon: IconBuildingBank },
  { label: 'Compare', to: '/compare', icon: IconArrowsDiff },
  { label: 'Reports', to: '/reports', icon: IconReportAnalytics },
  { label: 'Screening', to: '/screening', icon: IconListSearch },
];

/** Sits below a divider in the sidebar — a reference page rather than a place you work. */
export const ABOUT: NavItem = { label: 'About the data', to: '/data', icon: IconInfoCircle };
