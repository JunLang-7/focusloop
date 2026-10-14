import type { Routes } from '@angular/router';

/**
 * Settings is a modal overlay; navigation routes remain learning surfaces, with one exception:
 * `more` holds the record that is not a learning surface either (the week, the bridge, the event log)
 * and is a screen rather than a dialog because the event log has to be readable while a modal is open.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./pages/home.page').then((m) => m.HomePage),
    title: 'FocusLoop — Home',
  },
  {
    path: 'course/:courseId',
    loadComponent: () => import('./pages/course.page').then((m) => m.CoursePage),
    title: 'FocusLoop — Course',
  },
  {
    path: 'focus',
    loadComponent: () => import('./pages/focus.page').then((m) => m.FocusPage),
    title: 'FocusLoop — Focus Session',
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard.page').then((m) => m.DashboardPage),
    title: 'FocusLoop — Dashboard',
  },
  {
    path: 'more',
    loadComponent: () => import('./pages/more.page').then((m) => m.MorePage),
    title: 'FocusLoop — More data',
  },
  { path: '**', redirectTo: 'home' },
];
