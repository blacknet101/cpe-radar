document.querySelectorAll('form[action="/api/submissions"]').forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".status");
    const button = form.querySelector("button[type=submit]");
    status.className = "status";
    status.textContent = "Sending…";
    if (button) button.disabled = true;
    try {
      const res = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        status.classList.add("err");
        status.textContent = body.error || "Something went wrong. Please try again.";
        if (button) button.disabled = false;
        return;
      }
      form.reset();
      status.classList.add("ok");
      status.textContent = body.message || "Thanks — we received it and will review it.";
      if (button) button.disabled = false;
    } catch {
      status.classList.add("err");
      status.textContent = "Something went wrong. Please try again.";
      if (button) button.disabled = false;
    }
  });
});
