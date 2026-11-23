const CHEVRON_SVG = `<svg class="c-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const CHECK_SVG = `<svg class="c-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export interface CustomDropdown {
  sync: () => void;
  close: () => void;
}

const activeDropdowns: CustomDropdown[] = [];

function closeAllExcept(keep?: CustomDropdown): void {
  for (const dd of activeDropdowns) {
    if (dd !== keep) dd.close();
  }
}

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (!target?.closest(".c-select")) {
    closeAllExcept();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllExcept();
});

export function enhanceSelect(select: HTMLSelectElement): CustomDropdown {
  const wrap = document.createElement("div");
  wrap.className = "c-select";
  if (select.classList.contains("toolbar-select")) {
    wrap.classList.add("c-select-toolbar");
  }

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "c-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (select.title) trigger.title = select.title;

  const labelSpan = document.createElement("span");
  labelSpan.className = "c-select-label";
  trigger.appendChild(labelSpan);
  trigger.insertAdjacentHTML("beforeend", CHEVRON_SVG);

  const menu = document.createElement("div");
  menu.className = "c-select-menu hidden";
  menu.setAttribute("role", "listbox");

  let isOpen = false;

  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove("open");
    menu.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
  };

  const open = (): void => {
    closeAllExcept(api);
    isOpen = true;
    wrap.classList.add("open");
    menu.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
  };

  const sync = (): void => {
    const selectedOpt = select.options[select.selectedIndex];
    labelSpan.textContent = selectedOpt ? selectedOpt.textContent : "";

    menu.innerHTML = "";
    Array.from(select.options).forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "c-select-option";
      btn.setAttribute("role", "option");
      const isSelected = opt.value === select.value;
      btn.classList.toggle("selected", isSelected);
      btn.setAttribute("aria-selected", String(isSelected));

      const txt = document.createElement("span");
      txt.textContent = opt.textContent ?? "";
      btn.appendChild(txt);
      if (isSelected) {
        btn.insertAdjacentHTML("beforeend", CHECK_SVG);
      }

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (select.value !== opt.value) {
          select.value = opt.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        sync();
        close();
      });

      menu.appendChild(btn);
    });
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isOpen) close();
    else open();
  });

  select.addEventListener("change", () => sync());

  select.classList.add("c-select-native");
  select.parentNode?.insertBefore(wrap, select);
  wrap.appendChild(select);
  wrap.appendChild(trigger);
  wrap.appendChild(menu);

  const api: CustomDropdown = { sync, close };
  activeDropdowns.push(api);
  sync();
  return api;
}
