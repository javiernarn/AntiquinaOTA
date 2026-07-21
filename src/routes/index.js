import MainPage from "../pages/MainPage.jsx";
import LoginPage from "../pages/LoginPage.jsx";
import LogbookPage from "../pages/Logbook/LogbookPage.jsx";

export const publicRoutes = [
  { path: "/", component: MainPage },
  { path: "/login", component: LoginPage },
];

export const protectedRoutes = [
  { path: "/logbook", component: LogbookPage },
];
