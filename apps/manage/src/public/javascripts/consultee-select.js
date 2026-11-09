/**
 * The category page's bulk-remove checkboxes, following the MoJ Design System's
 * multi-select pattern. The header's "Select all" box is server-rendered with a
 * name, so a no-JS tick submits `select-all` - which the remove page reads as
 * every listed consultee. When this module runs it strips that name (the box
 * becomes a pure control that never submits) and wires the toggling: it checks
 * or clears every row checkbox, and each row checkbox keeps it in sync.
 */

/**
 * @param {HTMLElement} table - the table carrying data-module="consultee-select"
 */
export function enhanceConsulteeSelectTable(table) {
	const idPrefix = table.dataset.idPrefix || '';
	const toggle = table.querySelector(`input#${idPrefix}checkboxes-all`);
	const checkboxes = table.querySelectorAll('tbody input.govuk-checkboxes__input');
	if (!toggle || checkboxes.length === 0) {
		return;
	}
	toggle.removeAttribute('name');
	toggle.addEventListener('click', () => {
		for (const box of checkboxes) {
			box.checked = toggle.checked;
		}
	});
	for (const box of checkboxes) {
		box.addEventListener('click', () => {
			toggle.checked = [...checkboxes].every((other) => other.checked);
		});
	}
}

/**
 * Run once the page has loaded - module scripts are deferred by default.
 * @param {Document | undefined} documentTarget
 */
export function registerConsulteeSelect(documentTarget = globalThis.document) {
	if (!documentTarget) {
		return;
	}
	const init = () => {
		for (const table of documentTarget.querySelectorAll('[data-module="consultee-select"]')) {
			enhanceConsulteeSelectTable(table);
		}
	};
	if (documentTarget.readyState === 'loading') {
		documentTarget.addEventListener('DOMContentLoaded', init);
		return;
	}
	init();
}

registerConsulteeSelect();
