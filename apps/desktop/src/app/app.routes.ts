import type { Routes } from '@angular/router';

/**
 * Exactly five first-class surfaces. Anything more turns the demo into a
 * website.
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
  { path: '**', redirectTo: 'home' },
];
