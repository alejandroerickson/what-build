// Sets the theme before the first paint so a dark page never flashes light. Kept as its own file
// because the app's Content-Security-Policy allows only same-origin scripts (no inline ones).
// The stored choice is "light", "dark" or "system" (the default); html[data-theme] is always the
// resolved "light" or "dark". The app keeps it current when the choice or the system changes.
(function () {
  var choice = "system";
  try {
    var stored = localStorage.getItem("whatbuild.theme");
    if (stored === "light" || stored === "dark") choice = stored;
  } catch (e) {
    // Storage can be blocked; follow the system.
  }
  var dark = choice === "dark" || (choice === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
