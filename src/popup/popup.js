document.getElementById("open-options")?.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});
