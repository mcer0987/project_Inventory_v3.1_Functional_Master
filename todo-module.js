/**
 * TODO MODULE - Medipol Envanter Takip Sistemi
 * -----------------------------------------
 * @description Görev yönetimi, hatırlatıcılar ve personel arası etkileşim.
 */

window.todoModule = {
    state: {
        adminFilter: 'pool',
        personnelFilter: 'all',
        showCompleted: true,
        adminShowOnlyPending: false
    },

    /** Helper to get tasks with preserved IDs */
    /** Helper to get tasks with preserved IDs - Kararlı (Stable) Versiyon */
    getAllTasks: function () {
        if (!window.data || !window.data.tasks) return [];

        let taskList = [];
        if (Array.isArray(window.data.tasks)) {
            taskList = window.data.tasks;
        } else {
            taskList = Object.entries(window.data.tasks).map(([id, task]) => {
                return { ...task, id: task.id || id };
            });
        }

        return taskList.map((t, idx) => {
            const currentId = String(t.id);
            // Rastgelelikten kurtuluyoruz: Sabit ID üretiyoruz
            if (!t.id || currentId === 'undefined' || currentId === 'null' || currentId === '[object Object]') {
                const safeTitle = (t.title || "task").replace(/[^a-z0-9]/gi, '-').toLowerCase();
                t.id = `stable-${safeTitle}-${idx}`;
            }
            return t;
        });
    },

    // 📂 RENDERERS

    /** Admin TODO Tab Render */
    renderAdminTodo: function (filterType = null) {
        if (filterType !== null) this.state.adminFilter = filterType;

        const container = document.getElementById('todoTab');
        if (!container) return;

        if (!window.data) window.data = {};
        const allTasks = this.getAllTasks();
        const tasks = allTasks.filter(t => !t.isPersonal);
        const personnelList = Array.isArray(window.data.personel) ? window.data.personel : Object.values(window.data.personel || {});

        container.innerHTML = `
            <div class="todo-container">
                <div class="todo-header">
                    <div class="todo-header-left">
                        <h2 class="fw-bold mb-0">📝 TODO Paneli</h2>
                        <small class="text-muted">Tüm görevler ve iş dağıtımı</small>
                    </div>
                    <div class="todo-header-center d-flex align-items-center gap-3">
                        <select id="todoFilterPersonel" class="form-select" onchange="todoModule.renderAdminTodo(this.value)" style="width: 200px; height: 38px;">
                            <option value="all" ${this.state.adminFilter === 'all' ? 'selected' : ''}>Tüm Görevler</option>
                            <option value="pool" ${this.state.adminFilter === 'pool' ? 'selected' : ''} style="font-weight: bold; color: var(--color-primary);">📦 Görev Havuzu (Atanmamış)</option>
                            <optgroup label="Personeller">
                                ${personnelList.map(p => `<option value="${escapeHtml(p.name)}" ${this.state.adminFilter === p.name ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                            </optgroup>
                        </select>

                        <button class="todo-filter-btn ${this.state.adminShowOnlyPending ? 'active-warning' : ''}" 
                                onclick="todoModule.toggleAdminPendingFilter()" style="white-space: nowrap;">
                            <i class="fas ${this.state.adminShowOnlyPending ? 'fa-filter-circle-xmark' : 'fa-filter'}"></i> 
                            ${this.state.adminShowOnlyPending ? 'Tümünü Göster' : 'Tamamlanmamışlar'}
                        </button>
                    </div>
                    <div class="todo-header-right">
                        <button onclick="todoModule.openNewTaskModal('admin')" class="todo-btn-premium">
                            <i class="fas fa-plus"></i> Yeni Görev Ata
                        </button>
                    </div>
                </div>

                <div class="task-grid" id="adminTaskGrid">
                    ${this.generateTaskCards(tasks, 'admin')}
                </div>
            </div>
        `;
    },

    /** Personnel "Görevlerim" Tab Render */
    renderPersonnelTodo: function (filterType = 'all') {
        const container = document.getElementById('myTasksTab');
        if (!container) return;

        this.state.personnelFilter = filterType;
        const currentUser = window.currentUser ? window.currentUser.name : "";
        if (!window.isAppLoggedIn()) return;
        const allTasks = this.getAllTasks();

        let tasks = allTasks.filter(t => t.assigneeId === currentUser);

        if (filterType === 'tasks') tasks = tasks.filter(t => !t.isPersonal);
        if (filterType === 'reminders') tasks = tasks.filter(t => t.isPersonal);
        if (!this.state.showCompleted) tasks = tasks.filter(t => t.status !== 'Completed');

        container.innerHTML = `
            <div class="todo-container">
                <div class="todo-header d-flex justify-content-between align-items-center flex-wrap gap-3">
                    <div class="todo-header-left">
                        <h2 class="fw-bold mb-0">📅 Görevlerim</h2>
                        <small class="text-muted">Size özel filtreler ve görev yönetimi</small>
                    </div>
                    
                    <div class="todo-header-center d-flex align-items-center justify-content-center gap-2" style="flex-wrap: nowrap; overflow-x: auto;">
                        <div class="d-flex gap-1 p-1 bg-light rounded" style="border: 1px solid var(--color-border-light);">
                            <button class="todo-filter-btn ${filterType === 'all' ? 'active' : ''}" onclick="todoModule.renderPersonnelTodo('all')">Tümü</button>
                            <button class="todo-filter-btn ${filterType === 'tasks' ? 'active' : ''}" onclick="todoModule.renderPersonnelTodo('tasks')">Görevler</button>
                            <button class="todo-filter-btn ${filterType === 'reminders' ? 'active' : ''}" onclick="todoModule.renderPersonnelTodo('reminders')">Hatırlatıcılar</button>
                        </div>
                        <button class="todo-filter-btn ${this.state.showCompleted ? 'active-success' : ''}" 
                                onclick="todoModule.toggleCompletedVisibility()">
                            <i class="fas ${this.state.showCompleted ? 'fa-eye' : 'fa-eye-slash'}"></i> 
                            ${this.state.showCompleted ? 'Tamamlananları Göster' : 'Gizle'}
                        </button>
                    </div>

                    <div class="todo-header-right d-flex gap-2">
                        <button onclick="todoModule.openNewTaskModal('personel-task')" class="todo-btn-premium">
                            <i class="fas fa-plus"></i> Görev Ekle
                        </button>
                        <button onclick="todoModule.openNewTaskModal('personel-reminder')" class="todo-btn-premium" style="background: var(--color-purple);">
                            <i class="fas fa-sticky-note"></i> Hatırlatıcı Ekle
                        </button>
                    </div>
                </div>

                <div class="task-grid" id="personnelTaskGrid">
                    ${this.generateTaskCards(tasks, 'personel')}
                </div>
            </div>
        `;
    },

    toggleCompletedVisibility: function () {
        this.state.showCompleted = !this.state.showCompleted;
        this.renderPersonnelTodo(this.state.personnelFilter);
    },

    toggleAdminPendingFilter: function () {
        this.state.adminShowOnlyPending = !this.state.adminShowOnlyPending;
        this.renderAdminTodo();
    },

    /** Generate Task Cards HTML */
    generateTaskCards: function (tasks, viewMode) {
        if (tasks.length === 0) return `<div class="p-4 text-center text-muted">Henüz uygun görev bulunmuyor.</div>`;

        let filteredTasks = tasks;
        if (viewMode === 'admin') {
            const filterValue = this.state.adminFilter || 'pool';
            if (filterValue === 'pool') {
                filteredTasks = tasks.filter(t => !t.assigneeId || t.assigneeId === 'pool');
            } else if (filterValue && filterValue !== 'all') {
                filteredTasks = tasks.filter(t => t.assigneeId === filterValue);
            }

            // Tamamlanmamışlar filtresi
            if (this.state.adminShowOnlyPending) {
                filteredTasks = filteredTasks.filter(t => t.status !== 'Completed');
            }
        }

        return filteredTasks.sort((a, b) => b.id - a.id).map(task => {
            console.log(`Render Card: ${task.title} | ID: ${task.id}`);
            const isCompleted = task.status === 'Completed';
            const priorityClass = `priority-${escapeHtml(String(task.priority || 'Medium').toLowerCase())}`;
            const typeClass = task.isPersonal ? 'personal-task' : 'assigned-task';

            return `
                <div class="task-card ${typeClass} ${priorityClass} ${isCompleted ? 'completed' : ''}" id="task-${escapeHtml(task.id)}">
                    <div class="task-card-header d-flex justify-content-between align-items-center mb-2">
                        <h3 class="task-title mb-0" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</h3>
                        <div class="task-status-wrapper">
                            <input class="task-status-checkbox" type="checkbox" ${isCompleted ? 'checked' : ''} 
                                   onchange="todoModule.toggleTaskStatus(${jsArg(String(task.id))})" title="Tamamlandı İşaretle">
                        </div>
                    </div>
                    
                    <div class="task-card-body">
                        <p class="task-desc">${escapeHtml(task.description)}</p>
                        
                        <!-- Checklist Section -->
                        <div class="task-checklist mb-3">
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <small class="fw-bold text-muted">
                                    <i class="fas fa-tasks"></i> Alt Maddeler 
                                    ${this.getChecklistStats(task.checklist || [])}
                                </small>
                                <button onclick="todoModule.openChecklistModal(${jsArg(String(task.id))})" class="btn-madde-ekle"><i class="fas fa-list-check"></i> Yönet</button>
                            </div>
                            <div id="checklist-${escapeHtml(task.id)}">
                                ${this.generateChecklistItems(task.id, task.checklist || [], 3)}
                            </div>
                        </div>

                        ${!task.isPersonal ? `
                        <div class="task-interactions mt-3" id="interactions-${escapeHtml(task.id)}">
                            ${this.generateInteractions(task.interactions || [])}
                        </div>

                        <div class="interaction-input-group mt-2">
                            <input type="text" class="interaction-input" placeholder="Mesaj veya not yazın..." 
                                   id="input-${escapeHtml(task.id)}" onkeydown="if(event.key==='Enter') todoModule.addInteraction(${jsArg(String(task.id))})">
                            <button class="interaction-send-btn" onclick="todoModule.addInteraction(${jsArg(String(task.id))})" title="Gönder">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </div>
                        ` : `
                        <div class="interaction-placeholder mt-3 p-3">
                            <div class="text-center">
                                <i class="fas fa-lightbulb text-warning mb-2" style="font-size: 1.2rem;"></i>
                                <p class="mb-0">Bu alan size özeldir. Kendiniz için hatırlatıcı notlar düşebilir veya bu görevi takip edebilirsiniz.</p>
                            </div>
                        </div>`}
                    </div>

                    <div class="task-meta mt-auto pt-3 border-top d-flex align-items-center gap-2 flex-wrap">
                        <span class="task-badge badge-personnel">
                            👤 ${escapeHtml(task.assigneeId === 'pool' ? 'Havuz' : task.assigneeId)}
                        </span>
                        <span class="task-badge badge-date">
                            ⏰ ${escapeHtml(task.dueDate || 'Belirtilmedi')}
                        </span>
                        ${task.priority === 'High' ? `<span class="task-badge badge-priority-high">🔥 ACİL</span>` : ''}
                        
                        <div class="ms-auto d-flex gap-1">
                            ${(!task.assigneeId || task.assigneeId === 'pool') && viewMode === 'admin' ?
                    `<button onclick="todoModule.openAssignModal(${jsArg(String(task.id))})" class="btn btn-sm btn-outline-primary action-btn" title="Personele Ata"><i class="fas fa-user-plus"></i></button>` : ''}
                            <button onclick="todoModule.openEditTaskModal(${jsArg(String(task.id))})" class="btn btn-sm btn-outline-secondary action-btn" title="Görevi Düzenle"><i class="fas fa-edit"></i></button>
                            <button onclick="todoModule.deleteTask(${jsArg(String(task.id))})" class="btn btn-sm btn-outline-danger action-btn" title="Görevi Sil"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    getChecklistStats: function (items) {
        if (!items || items.length === 0) return "";
        const doneCount = items.filter(i => i.done).length;
        return `<span class="checklist-counter ml-1">(${doneCount}/${items.length})</span>`;
    },

    generateChecklistItems: function (taskId, items, limit = null) {
        if (!items || items.length === 0) return `<small class="text-muted d-block ps-2">Madde bulunmuyor.</small>`;

        let displayItems = items;
        let moreCount = 0;

        if (limit && items.length > limit) {
            displayItems = items.slice(0, limit);
            moreCount = items.length - limit;
        }

        let html = displayItems.map((item, idx) => `
            <div class="d-flex align-items-center gap-2 ps-2 mb-1 checklist-item">
                <input type="checkbox" ${escapeHtml(item.done ? 'checked' : '')} onchange="todoModule.toggleChecklistItem(${jsArg(String(taskId))}, ${idx})" class="checklist-checkbox">
                <span class="small ${escapeHtml(item.done ? 'text-decoration-line-through text-muted' : '')}">${escapeHtml(item.text)}</span>
            </div>
        `).join('');

        if (moreCount > 0) {
            html += `
                <div class="checklist-more-link" onclick="todoModule.openChecklistModal(${jsArg(String(taskId))})">
                    <i class="fas fa-ellipsis-h"></i> ve ${moreCount} adet daha...
                </div>
            `;
        }

        return html;
    },

    generateInteractions: function (interactions) {
        return interactions.map(i => `
            <div class="interaction-item">
                <span class="user">${escapeHtml(i.user)}:</span>
                <span class="text">${escapeHtml(i.message || i.text || "")}</span>
                <span class="date">${escapeHtml(i.time || i.date || "")}</span>
            </div>
        `).join('');
    },

    // 🛠️ ACTIONS

    toggleTaskStatus: async function (taskId) {
        const allTasks = this.getAllTasks();
        const task = allTasks.find(t => String(t.id) === String(taskId));
        if (task) {
            task.status = task.status === 'Completed' ? 'Pending' : 'Completed';
            task.updatedAt = new Date().toISOString();
            await window.saveData('tasks', allTasks);
            showAppAlert("Görev durumu güncellendi.");
            this.updateNavBadge();
        }
    },

    /** Türkiye Saatine Göre Saat Formatla (HH:mm) */
    getTRTime: function () {
        return new Date().toLocaleTimeString('tr-TR', {
            timeZone: 'Europe/Istanbul',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    },

    addInteraction: async function (taskId, message) {
        // Eğer mesaj dışarıdan gelmemişse (buton tıklaması), inputtan çek
        const input = document.getElementById(`input-${taskId}`);
        const finalMessage = message || (input ? input.value : "");

        if (!finalMessage || !finalMessage.trim()) return;

        const currentUser = window.currentUser ? window.currentUser.name : "Sistem";
        const allTasks = this.getAllTasks();
        const task = allTasks.find(t => String(t.id) === String(taskId));

        if (task) {
            if (!task.interactions) task.interactions = [];
            task.interactions.push({
                user: currentUser,
                message: finalMessage.trim(),
                time: this.getTRTime(),
                timestamp: Date.now()
            });
            task.updatedAt = new Date().toISOString();

            // İnputu temizle
            if (input) input.value = "";

            await window.saveData('tasks', allTasks);

            // Aktif sekmeye göre render et
            if (document.getElementById('todoTab')) this.renderAdminTodo();
            if (document.getElementById('myTasksTab')) this.renderPersonnelTodo();
        }
    },

    deleteTask: async function (taskId) {
        showCustomConfirm(
            "🗑️ Görevi Sil",
            "Bu görevi silmek istediğinize emin misiniz?",
            async () => {
                const allTasks = this.getAllTasks();
                const index = allTasks.findIndex(t => String(t.id) === String(taskId));
                if (index > -1) {
                    allTasks.splice(index, 1);
                    await window.saveData('tasks', allTasks);
                    showAppAlert("Görev başarıyla silindi.", "success");
                }
            }
        );
    },

    // ✅ CHECKLIST MODAL & ACTIONS
    openChecklistModal: function (taskId) {
        const allTasks = this.getAllTasks();
        const task = allTasks.find(t => String(t.id) === String(taskId));
        if (!task) return;

        // Clone current checklist for temporary editing
        this.tempChecklist = JSON.parse(JSON.stringify(task.checklist || []));
        this.activeTaskId = taskId;
        this.renderChecklistModal(taskId);
    },

    renderChecklistModal: function (taskId) {
        const modalId = 'checklistModal';
        let modal = document.getElementById(modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal checklist-modal';
            modal.style.display = 'none';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-content checklist-modal-content">
                <button onclick="todoModule.closeChecklistModal()" class="btn-close-custom" title="Kapat"><i class="fas fa-times"></i></button>
                
                <h5 class="fw-bold mb-4"><i class="fas fa-list-check text-primary"></i> Alt Maddeleri Yönet</h5>

                <div class="checklist-input-area mb-4">
                    <input type="text" id="newSubItemInput" placeholder="Yeni madde ekleyin..." 
                           onkeydown="if(event.key==='Enter') todoModule.addToTempChecklist()">
                    <button class="btn btn-primary btn-sm px-3" onclick="todoModule.addToTempChecklist()">Ekle</button>
                </div>

                <div class="temp-checklist-items mb-4" id="tempChecklistContainer">
                    ${this.tempChecklist.length === 0 ? '<p class="text-center text-muted small py-4"><i>Henüz madde eklenmedi.</i></p>' :
                this.tempChecklist.map((item, idx) => `
                        <div class="temp-item">
                            <i class="fas fa-grip-vertical text-muted" style="font-size: 11px; opacity: 0.5;"></i>
                            <input type="text" value="${escapeHtml(item.text)}" onchange="todoModule.editTempItem(${idx}, this.value)">
                            <button class="btn-remove" onclick="todoModule.removeFromTempChecklist(${idx})" title="Sil">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>

                <div class="d-flex justify-content-end gap-2 pt-2">
                    <button onclick="todoModule.closeChecklistModal()" class="btn btn-outline-secondary btn-sm px-4">Vazgeç</button>
                    <button onclick="todoModule.saveChecklist(${jsArg(String(taskId))})" class="btn btn-success btn-sm px-4">Kaydet</button>
                </div>
            </div>
        `;
        modal.style.display = 'block';
    },

    addToTempChecklist: function () {
        const input = document.getElementById('newSubItemInput');
        const text = input.value.trim();
        if (!text) return;
        this.tempChecklist.push({ text: text, done: false });
        input.value = "";
        this.renderChecklistModal(this.activeTaskId);
    },

    editTempItem: function (idx, val) {
        if (this.tempChecklist[idx]) this.tempChecklist[idx].text = val;
    },

    removeFromTempChecklist: function (idx) {
        this.tempChecklist.splice(idx, 1);
        this.renderChecklistModal(this.activeTaskId);
    },

    // saveChecklist: async function(taskId) {
    //     console.log("Saving checklist for task:", taskId); // Debug
    //     const allTasks = this.getAllTasks();
    //     const task = allTasks.find(t => String(t.id) === String(taskId));

    //     if (task) {
    //         task.checklist = this.tempChecklist;
    //         await window.saveData('tasks', allTasks);
    //         showAppAlert("Alt maddeler güncellendi.", "success");
    //         this.closeChecklistModal();

    //         // Immediate re-render
    //         if (typeof window.renderLocationsTable === 'function' && document.getElementById('todoTab')) {
    //              this.renderAdminTodo();
    //         } else if (document.getElementById('personnelTodoContent')) {
    //              this.renderPersonnelTodo();
    //         }
    //     } else {
    //         console.error("Task not found for ID:", taskId);
    //     }
    // },

    /**
        * 🕵️ SAVING PROCESS WITH DEEP DEBUGGING (Gelişmiş Hata Yakalama)
        */
    saveChecklist: async function (taskId) {
        try {
            console.group("🚀 Alt Madde Kayıt Süreci Başladı");
            console.log("1. Gelen taskId:", taskId, " Tipi:", typeof taskId);
            if (!taskId || taskId === 'undefined' || taskId === 'null') {
                throw new Error("KRİTİK: taskId 'undefined' veya boş geldi! Modal hangi göreve ait olduğunu bilmiyor.");
            }
            const allTasks = this.getAllTasks();
            console.log("2. Toplam Görev Sayısı:", allTasks.length);
            // ID'yi hem string hem number olarak zorlayarak arama yapıyoruz
            const task = allTasks.find(t => String(t.id) === String(taskId));

            if (!task) {
                console.error("3. Mevcut Tüm Görev ID'leri:", allTasks.map(t => t.id));
                throw new Error(`BAĞLANTI HATASI: ID'si '${taskId}' olan görev window.data.tasks içinde bulunamadı.`);
            }
            console.log("4. Hedef Görev Bulundu:", task.title, "(ID: " + task.id + ")");
            console.log("5. Kaydedilecek Alt Maddeler:", this.tempChecklist);
            // Veriyi yerel objeye işle
            task.checklist = this.tempChecklist;
            task.updatedAt = new Date().toISOString();
            // Firebase'e gönder (window.saveData projenin ana kayıt fonksiyonudur)
            console.log("6. window.saveData çağrılıyor...");
            await window.saveData('tasks', allTasks);

            console.log("7. Veri başarıyla Firebase'e iletildi.");
            showAppAlert("Alt maddeler güncellendi.", "success");
            this.closeChecklistModal();
            // Arayüzü anlık tazele
            if (document.getElementById('todoTab')) {
                console.log("8. Admin paneli yenileniyor...");
                this.renderAdminTodo();
            } else if (document.getElementById('myTasksTab')) {
                console.log("8. Personel paneli yenileniyor...");
                this.renderPersonnelTodo();
            }
            console.groupEnd();
        } catch (error) {
            console.group("❌ KAYIT HATASI DETAYI");
            console.error("Hata Mesajı:", error.message);
            console.error("Hata Stack:", error.stack);
            console.groupEnd();
            showAppAlert("Hata: " + error.message, "danger");
        }
    },

    closeChecklistModal: function () {
        const modal = document.getElementById('checklistModal');
        if (modal) modal.style.display = 'none';
    },

    toggleChecklistItem: async function (taskId, idx) {
        const allTasks = this.getAllTasks();
        const task = allTasks.find(t => String(t.id) === String(taskId));
        if (task && task.checklist[idx]) {
            task.checklist[idx].done = !task.checklist[idx].done;
            task.updatedAt = new Date().toISOString();
            await window.saveData('tasks', allTasks);
        }
    },

    removeChecklistItem: async function (taskId, idx) {
        const allTasks = this.getAllTasks();
        const task = allTasks.find(t => String(t.id) === String(taskId));
        if (task && task.checklist) {
            task.checklist.splice(idx, 1);
            await window.saveData('tasks', allTasks);
        }
    },

    // 📝 EDIT ACTIONS
    openEditTaskModal: function (taskId) {
        const allTasks = this.getAllTasks();
        const task = allTasks.find(t => String(t.id) === String(taskId));
        if (!task) return;

        this.openNewTaskModal(task.isPersonal ? 'personel-reminder' : 'admin');

        // Modalın başlığını ve butonunu güncelle
        setTimeout(() => {
            document.querySelector('#todoTaskModal h3').innerText = "Görevi Düzenle";
            document.getElementById('todoTaskTitle').value = task.title;
            document.getElementById('todoTaskDesc').value = task.description;
            document.getElementById('todoTaskPriority').value = task.priority;
            document.getElementById('todoTaskDate').value = task.dueDate || "";
            document.getElementById('todoTaskAssignee').value = task.assigneeId;

            const saveBtn = document.querySelector('#todoTaskModal .todo-btn-premium');
            saveBtn.innerText = "Güncelle";
            saveBtn.onclick = () => this.updateTask(taskId);
        }, 100);
    },

    updateTask: async function (taskId) {
        const title = document.getElementById('todoTaskTitle').value;
        const desc = document.getElementById('todoTaskDesc').value;
        const priority = document.getElementById('todoTaskPriority').value;
        const date = document.getElementById('todoTaskDate').value;
        const assignee = document.getElementById('todoTaskAssignee').value;
        // Faz 4 · J1 (M3): Rules v2 etiket reddiyle aynı kontrol, kayıttan önce.
        if (window.guardTagLike && window.guardTagLike({ 'Başlık': title, 'Açıklama': desc })) return;

        const allTasks = Array.isArray(window.data.tasks) ? window.data.tasks : Object.values(window.data.tasks || {});
        const task = allTasks.find(t => String(t.id) === String(taskId));
        if (task) {
            task.title = title;
            task.description = desc;
            task.priority = priority;
            task.dueDate = date;
            task.assigneeId = assignee;
            task.updatedAt = new Date().toISOString();
            await window.saveData('tasks', allTasks);
            showAppAlert("Görev güncellendi.", "success");
            this.closeModal();
        }
    },

    openNewTaskModal: function (mode) {
        const personnelList = Array.isArray(window.data.personel) ? window.data.personel : Object.values(window.data.personel || {});
        const currentUser = window.currentUser ? window.currentUser.name : "";
        if (!window.isAppLoggedIn()) return;

        let modalTitle = "Yeni Görev Ata";
        let assigneeLabel = "Atanan Personel / Havuz";
        let isLocked = false;
        let defaultAssignee = "pool";

        if (mode === 'personel-task') {
            modalTitle = "Kendine Görev Ekle";
            assigneeLabel = "Sorumlu Personel";
            isLocked = true;
            defaultAssignee = currentUser;
        } else if (mode === 'personel-reminder') {
            modalTitle = "Yeni Hatırlatıcı Oluştur";
            assigneeLabel = "Oluşturan Personel";
            isLocked = true;
            defaultAssignee = currentUser;
        }

        const modalId = 'todoTaskModal';
        let modal = document.getElementById(modalId);

        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal';
            modal.style.display = 'none';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; margin: 5% auto; padding: 30px; border-radius: 15px;">
                <h3 class="fw-bold mb-4">${modalTitle}</h3>
                <input type="hidden" id="todoTaskMode" value="${mode}">
                <div class="form-group mb-3">
                    <label>Başlık</label>
                    <input type="text" id="todoTaskTitle" class="form-control" placeholder="Örn: Raporu hazırla">
                </div>
                <div class="form-group mb-3">
                    <label>Açıklama</label>
                    <textarea id="todoTaskDesc" class="form-control" rows="3"></textarea>
                </div>
                <div class="row">
                    <div class="col-md-6 form-group mb-3">
                        <label>${assigneeLabel}</label>
                        <select id="todoTaskAssignee" class="form-select" ${isLocked ? 'disabled' : ''}>
                            <option value="pool">📦 Görev Havuzu</option>
                            ${personnelList.map(p => `<option value="${escapeHtml(p.name)}" ${escapeHtml(p.name === defaultAssignee ? 'selected' : '')}>${escapeHtml(p.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="col-md-6 form-group mb-3">
                        <label>Öncelik</label>
                        <select id="todoTaskPriority" class="form-select">
                            <option value="Low">Düşük</option>
                            <option value="Normal" selected>Normal</option>
                            <option value="High">Yüksek / Acil</option>
                        </select>
                    </div>
                </div>
                <div class="form-group mb-4">
                    <label>Bitiş Tarihi (Opsiyonel)</label>
                    <input type="date" id="todoTaskDate" class="form-control">
                </div>
                <div class="d-flex justify-content-end gap-2">
                    <button onclick="todoModule.closeModal()" class="btn btn-light">İptal</button>
                    <button onclick="todoModule.saveNewTask()" class="todo-btn-premium">Kaydet</button>
                </div>
            </div>
        `;

        modal.style.display = 'block';
    },

    openAssignModal: function (taskId) {
        const personnelList = Array.isArray(window.data.personel) ? window.data.personel : Object.values(window.data.personel || {});

        showCustomConfirm(
            "👤 Görevi Ata",
            `<div style="min-width: 250px;">
                <p>Bu görevi kime atamak istersiniz?</p>
                <select id="quickAssignSelect" class="form-select">
                    ${personnelList.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>`,
            async () => {
                const assignee = document.getElementById('quickAssignSelect').value;
                await this.assignTask(taskId, assignee);
            }
        );
    },

    assignTask: async function (taskId, assignee) {
        const allTasks = this.getAllTasks();
        const task = allTasks.find(t => String(t.id) === String(taskId));
        if (task) {
            task.assigneeId = assignee;
            task.isPersonal = false;
            await window.saveData('tasks', allTasks);
            showAppAlert(`Görev ${assignee} personeline atandı.`, "success");
        }
    },

    closeModal: function () {
        const modal = document.getElementById('todoTaskModal');
        if (modal) modal.style.display = 'none';
    },

    saveNewTask: async function () {
        const title = document.getElementById('todoTaskTitle').value;
        const desc = document.getElementById('todoTaskDesc').value;
        const assignee = document.getElementById('todoTaskAssignee').value;
        const priority = document.getElementById('todoTaskPriority').value;
        const date = document.getElementById('todoTaskDate').value;
        const mode = document.getElementById('todoTaskMode').value;

        if (!title) {
            showAppAlert("Lütfen bir başlık girin!", "warning");
            return;
        }
        if (window.guardTagLike && window.guardTagLike({ 'Başlık': title, 'Açıklama': desc })) return;   // Faz 4 · J1 (M3)

        const newTask = {
            id: Date.now(),
            title: title,
            description: desc,
            assigneeId: assignee,
            creatorId: window.currentUser ? window.currentUser.name : "Admin",
            priority: priority,
            dueDate: date,
            status: 'Pending',
            isPersonal: mode === 'personel-reminder',
            interactions: [],
            checklist: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const allTasks = Array.isArray(window.data.tasks) ? window.data.tasks : Object.values(window.data.tasks || {});
        allTasks.push(newTask);

        await window.saveData('tasks', allTasks);
        showAppAlert("Görev başarıyla oluşturuldu.", "success");
        this.closeModal();
    },

    // 🔔 NOTIFICATIONS

    /** Bekleyen görevleri kontrol et ve bildirim gönder */
    checkPendingTasks: async function () {
        const currentUser = window.currentUser ? window.currentUser.name : "";
        if (!window.isAppLoggedIn()) return;
        if (!currentUser) return;

        // 🔔 Rozeti her zaman güncelliyoruz (Sessiz güncelleme)
        this.updateNavBadge();

        // Eğer Launchpad aktifse modal popup çıkarma
        const lpView = document.getElementById('launchpad-view');
        if (lpView && lpView.style.display !== 'none') return;

        const sessionKey = `todo_notified_${currentUser}`;
        const lastCheckSession = sessionStorage.getItem(sessionKey);

        // KRİTİK: Eğer bu oturumda (session) daha önce bildirim gösterildiyse MODAL ÇIKARTMA
        if (lastCheckSession) return;

        const allTasks = this.getAllTasks();

        // Sadece bekleyen ve bana atanmış görevleri bul
        const notifyTasks = allTasks.filter(t => {
            const isAssignedToMe = t.assigneeId === currentUser;
            const isPending = t.status === 'Pending';

            if (isAssignedToMe && isPending) {
                // Eğer görevi ben oluşturmadıysam VEYA içinde başkasının mesajı varsa bildirim adayıdır
                return t.creatorId !== currentUser || (t.interactions && t.interactions.some(i => i.user !== currentUser));
            }
            return false;
        });

        if (notifyTasks.length > 0) {
            const lastTask = notifyTasks[notifyTasks.length - 1];
            const isReply = lastTask.interactions && lastTask.interactions.length > 0;
            const title = isReply ? "💬 Yeni Mesaj / Cevap" : "📅 Görev Bildirimleri";
            const msg = isReply ?
                `Görevinize yeni bir mesaj/cevap eklendi. İncelemek ister misiniz?` :
                `Üzerinizde yeni atanmış **${notifyTasks.length}** adet bekleyen görev bulunuyor.`;

            // Oturumu işaretle (Artık bu giriş süresince bir daha modal gelmeyecek)
            sessionStorage.setItem(sessionKey, "true");
            localStorage.setItem('last_todo_check_time', Date.now().toString());

            const confirmed = await window.showCustomConfirm(
                title,
                msg,
                "Evet, Göster",
                "Daha Sonra"
            );

            if (confirmed) {
                if (typeof window.switchTab === 'function') {
                    window.switchTab('myTasksTab');
                }
            }
        }
    },


    /** Navbar Rozetini Güncelle */
    updateNavBadge: function () {
        const currentUser = window.currentUser ? window.currentUser.name : "";
        if (!window.isAppLoggedIn()) return;
        if (!currentUser) return;

        const allTasks = this.getAllTasks();
        // Sadece başkası tarafından bana atanmış ve bekleyen görevleri say
        const pendingCount = allTasks.filter(t =>
            t.assigneeId === currentUser &&
            t.creatorId !== currentUser &&
            t.status === 'Pending'
        ).length;

        const badgeContainer = document.getElementById('nav-todo-badge');
        const badgeCountEl = document.getElementById('nav-todo-count');

        if (badgeContainer && badgeCountEl) {
            if (pendingCount > 0) {
                badgeCountEl.textContent = pendingCount;
                badgeCountEl.classList.remove('badge-hidden');
                badgeContainer.classList.add('has-tasks');
                badgeContainer.classList.remove('is-passive');
            } else {
                badgeCountEl.classList.add('badge-hidden');
                badgeContainer.classList.remove('has-tasks');
                badgeContainer.classList.add('is-passive');
            }
        }

        // 📊 Admin Status Bar Bildirimi (Eğer admin panelindeysek)
        this.updateAdminStatusBadge();
    },

    /** Admin Status Bar üzerindeki genel bekleyen iş yükünü güncelle */
    updateAdminStatusBadge: function () {
        const badgeContainer = document.getElementById('admin-nav-todo-badge');
        const badgeCountEl = document.getElementById('admin-nav-todo-count');
        if (!badgeContainer || !badgeCountEl) return;

        const allTasks = this.getAllTasks();

        const notifyTasks = allTasks.filter(t => {
            if (!t || !t.id || t.status !== 'Pending') return false;

            // 1. Hatırlatıcıları atla
            if (t.isReminder === true) return false;

            // 2. Havuzdakileri atla
            const assignee = (t.assigneeId || "").toString().toLowerCase().trim();
            if (assignee === 'pool' || assignee === 'Havuz') return false;

            // 🌟 3. Admin Bildirim Kriteri: 
            // Eğer son mesajı atan kişi Admin değilse, bu Admin için "Bekleyen Soru/İş" demektir.
            const lastInteraction = t.interactions && t.interactions.length > 0 ? t.interactions[t.interactions.length - 1] : null;
            if (lastInteraction && lastInteraction.user !== currentUser) return true;

            // Eğer görev yeni atanmışsa ve henüz işlem görmemişse
            return true;
        });

        const globalPendingCount = notifyTasks.length;

        // 🔍 DEBUG: Hangi görevler sayılıyor? (Konsoldan takip edilebilir)
        if (globalPendingCount > 0) {
            console.log("📊 [Admin Sayaç] Sayılan Görevler:", notifyTasks.map(t => t.description || t.id));
        }

        if (globalPendingCount > 0) {
            badgeCountEl.textContent = globalPendingCount;
            badgeCountEl.classList.remove('badge-hidden');
            badgeContainer.classList.add('has-tasks');
            badgeContainer.classList.remove('is-passive');
        } else {
            badgeCountEl.classList.add('badge-hidden');
            badgeContainer.classList.remove('has-tasks');
            badgeContainer.classList.add('is-passive');
        }
    }
};

// Global fonksiyonları expose et
window.renderTodoTab = () => todoModule.renderAdminTodo();
window.renderMyTasksTab = () => todoModule.renderPersonnelTodo();
window.checkPendingTasks = () => {
    // Sayfa yüklenirken UI'ın (confirm modal vb.) hazır olması için kısa bir bekleme
    setTimeout(() => {
        todoModule.checkPendingTasks();
    }, 1000);
};

// Modül referansını dışarı aç
window.todoModule = todoModule;
