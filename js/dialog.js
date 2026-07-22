/**
 * In-page dialogs (replaces alert/confirm).
 * Extends ModuleManager.prototype — load after module-manager.js
 */
Object.assign(ModuleManager.prototype, {
    closeAppDialog() {
        const dialog = document.getElementById('appDialog');
        if (dialog) dialog.classList.remove('active');
        this._dialogResolver = null;
    },

    showDialog({ title = 'Notice', bodyHtml = '', buttons = [] } = {}) {
        const dialog = document.getElementById('appDialog');
        const titleEl = document.getElementById('appDialogTitle');
        const bodyEl = document.getElementById('appDialogBody');
        const footerEl = document.getElementById('appDialogFooter');
        if (!dialog || !titleEl || !bodyEl || !footerEl) {
            console.error('[Dialog] App dialog elements missing');
            return Promise.resolve(null);
        }

        titleEl.textContent = title;
        bodyEl.innerHTML = bodyHtml;
        footerEl.innerHTML = '';

        return new Promise((resolve) => {
            this._dialogResolver = resolve;

            const finish = (value) => {
                this.closeAppDialog();
                resolve(value);
            };

            buttons.forEach((btn) => {
                const el = document.createElement('button');
                el.type = 'button';
                el.className = `btn ${btn.className || 'btn-secondary'}`;
                el.textContent = btn.label || 'OK';
                el.addEventListener('click', () => {
                    const value = typeof btn.value === 'undefined' ? true : btn.value;
                    finish(value);
                    if (typeof btn.onClick === 'function') btn.onClick(value);
                });
                footerEl.appendChild(el);
            });

            if (!buttons.length) {
                const ok = document.createElement('button');
                ok.type = 'button';
                ok.className = 'btn btn-primary';
                ok.textContent = 'OK';
                ok.addEventListener('click', () => finish(true));
                footerEl.appendChild(ok);
            }

            dialog.classList.add('active');
        });
    },

    showAlert(message, title = 'Notice') {
        return this.showDialog({
            title,
            bodyHtml: `<p class="app-dialog-message">${escapeHtml(message)}</p>`,
            buttons: [{ label: 'OK', className: 'btn-primary', value: true }]
        });
    },

    showConfirm(message, title = 'Confirm') {
        return this.showDialog({
            title,
            bodyHtml: `<p class="app-dialog-message">${escapeHtml(message)}</p>`,
            buttons: [
                { label: 'Cancel', className: 'btn-secondary', value: false },
                { label: 'Confirm', className: 'btn-primary', value: true }
            ]
        });
    },

    showWidgetFailureDialog(failures) {
        if (!failures || !failures.length) return;

        const items = failures.map((f) => {
            const type = f.module && f.module.type ? f.module.type : '?';
            const label = (typeof this.getWidgetLabel === 'function')
                ? this.getWidgetLabel(type)
                : type;
            const errMsg = f.error && f.error.message ? f.error.message : String(f.error || 'Unknown error');
            return `<li><strong>${escapeHtml(label)}</strong> — <code>${escapeHtml(errMsg)}</code></li>`;
        }).join('');

        this.showDialog({
            title: 'Widget error',
            bodyHtml: `
                <p class="app-dialog-message">One or more widgets failed to create. Details were written to Logs.</p>
                <ul class="app-dialog-list">${items}</ul>
                <p class="app-dialog-hint">Clearing widgets can restore a working Home layout. System Monitor will be recreated.</p>
            `,
            buttons: [
                { label: 'Keep widgets', className: 'btn-secondary', value: false },
                {
                    label: 'Clear widgets',
                    className: 'btn-danger',
                    value: true,
                    onClick: (confirmed) => {
                        if (confirmed) this.clearAllWidgets({ skipConfirm: true });
                    }
                }
            ]
        });
    },

    setupDialogListeners() {
        const appDialog = document.getElementById('appDialog');
        const appDialogClose = document.getElementById('appDialogClose');
        if (appDialogClose) {
            appDialogClose.addEventListener('click', () => {
                const resolver = this._dialogResolver;
                this.closeAppDialog();
                if (typeof resolver === 'function') resolver(false);
            });
        }
        if (appDialog) {
            appDialog.addEventListener('click', (e) => {
                if (e.target.id === 'appDialog') {
                    const resolver = this._dialogResolver;
                    this.closeAppDialog();
                    if (typeof resolver === 'function') resolver(false);
                }
            });
        }
    }
});
