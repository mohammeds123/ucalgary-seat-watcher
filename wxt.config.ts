import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "UCalgary Seat Watcher",
    description:
      "Alerts you when a seat opens in a course you're watching. Never enrols you into a waitlisted course before its purge day.",
    permissions: [
      "storage",
      "alarms",
      "notifications",
      "offscreen",
      "tabs",
    ],
    host_permissions: [
      "https://portal.my.ucalgary.ca/*",
      "https://csprd.my.ucalgary.ca/*",
    ],
  },
});
