// views/js/todo.js
// Personal Todo list functionality for management.html page

let loggedInUser = null; 
let allTasks = [];
let allProjects = [];
let currentFilter = 'all';

const priorityMap = { 1: 'High', 2: 'Medium', 3: 'Low' };
const statusMap   = { 1: 'To Do', 2: 'In Progress', 3: 'Done' };

document.addEventListener('DOMContentLoaded', async () => {
    // Load logged in user profile first
    try {
        const userRes = await fetch('/api/todo/me');
        if (userRes.ok) {
            loggedInUser = await userRes.json(); // { member_id: X, display_name: '...' }
        }
    } catch (err) {
        console.warn("Could not load current user profile.", err);
    }

    await Promise.all([loadTasks(), loadProjects()]);

    document.getElementById('statusFilters').addEventListener('click', e => {
        if (!e.target.matches('.pill')) return;
        document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.status;
        renderTasks();
    });

    document.getElementById('searchInput').addEventListener('input', renderTasks);
});

// =========== DATA ===========
async function loadTasks() {
    try {
        const res = await fetch('/api/todo/tasks');
        allTasks = await res.json();
      
        updateStats();
        renderTasks();
    } catch(err) {
        document.getElementById('taskBody').innerHTML =
            '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">&#x26A0;&#xFE0F;</div><p>Failed to load tasks.</p></div></td></tr>';
    }
}

async function loadProjects() {
    try {
        const res = await fetch('/api/todo/projects');
        allProjects = await res.json();
        populateProjectSelects();
    } catch(err) { console.error('Failed to load projects', err); }
}

async function quickCreateTask() {
    const titleInput = document.getElementById('quick_title');
    const title = titleInput.value.trim();
    
    if (!title) { 
        alert('Please enter a task title.'); 
        return; 
    }

    const selectedProject = document.getElementById('filter_project').value;
    const projectId = selectedProject ? parseInt(selectedProject) : null;
    let assigneeId = loggedInUser ? loggedInUser.member_id : null;

    if (!assigneeId) {
        alert('Your session has expired. Please refresh the page and sign in again.');
        return;
    }

    const payload = {
        title: title,
        description: null,
        priorityId: 2, // Medium default
        statusId: 1,   // To Do default
        projectId: projectId,
        dueDate: null
    };

    try {
        const res = await fetch('/api/todo/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) { 
            titleInput.value = ''; // Clean out the quick entry box
            await loadTasks();     // Re-fetch records and sync workspace
        } else { 
            alert('Failed to quick create task: ' + await res.text()); 
        }
    } catch { 
        alert('Connection error encountered during quick creation.'); 
    }
}

// =========== RENDER ===========
function renderTasks() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const targetProject  = document.getElementById('filter_project').value;

    let filteredTasks = allTasks.filter(t => {
        // Status filter: "all" excludes Done (status_id 3)
        const matchStatus = currentFilter === 'all' 
            ? String(t.status_id) !== '3' 
            : String(t.status_id) === currentFilter;
        
        // Search bar filter
        const matchSearch = !search ||
            t.title.toLowerCase().includes(search) ||
            (t.description || '').toLowerCase().includes(search) ||
            (t.assignee_name || '').toLowerCase().includes(search);
            
        // Top-level Project filter
        const matchProject = !targetProject || String(t.project_id) === String(targetProject);

        return matchStatus && matchSearch && matchProject;
    });

    if (filteredTasks.length === 0) {
        document.getElementById('taskBody').innerHTML =
            '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">&#x2713;</div><p>No tasks found.</p></div></td></tr>';
        return;
    }

    document.getElementById('taskBody').innerHTML = filteredTasks.map(t => {
        const isDone = t.status_id === 3;
        const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '&#x2014;';
        const isOverdue = t.due_date && !isDone && new Date(t.due_date) < new Date();

        return '<tr class="' + (isDone ? 'done' : '') + '">' +
            '<td>' +
                '<div class="task-title ' + (isDone ? 'done-text' : '') + '">' + escHtml(t.title) + '</div>' +
                (t.description ? '<div class="task-desc">' + escHtml(t.description.substring(0,80)) + (t.description.length>80?'&#x2026;':'') + '</div>' : '') +
                (t.project_name ? '<div class="task-desc" style="color:var(--accent-2);margin-top:3px">&#x25C8; ' + escHtml(t.project_name) + '</div>' : '') +
            '</td>' +
            '<td><span class="assignee-chip">' + escHtml(t.assignee_name || '&#x2014;') + '</span></td>' +
            '<td><span class="badge badge-priority-' + t.priority_id + '">' + (priorityMap[t.priority_id] || t.priority_id) + '</span></td>' +
            '<td>' +
                '<select onchange="updateTaskStatus(' + t.task_id + ', this.value)" class="badge badge-status-' + t.status_id + '" style="background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-sm); padding: 4px; cursor: pointer; outline: none; font-family: var(--font-mono); font-size: 0.65rem;">' +
                    '<option value="1"' + (t.status_id === 1 ? ' selected' : '') + '>To Do</option>' +
                    '<option value="2"' + (t.status_id === 2 ? ' selected' : '') + '>In Progress</option>' +
                    '<option value="3"' + (t.status_id === 3 ? ' selected' : '') + '>Done</option>' +
                '</select>' +
            '</td>' +
            '<td class="font-mono" style="font-size:0.75rem;' + (isOverdue ? 'color:var(--danger)' : 'color:var(--text-secondary)') + '">' + dueStr + (isOverdue?' &#x26A0;':'') + '</td>' +
        '</tr>';
    }).join('');
}

async function updateTaskStatus(taskId, statusId) {
    try {
        const res = await fetch('/api/todo/tasks/' + taskId + '/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ statusId: parseInt(statusId) })
        });
        if (res.ok) {
            await loadTasks();
        } else {
            alert('Failed to update status: ' + await res.text());
        }
    } catch (err) {
        alert('Connection error updating status.');
        console.error(err);
    }
}

function applyBoardFilters() {
    renderTasks();
}

function clearBoardFilters() {
    document.getElementById('filter_project').value = "";
    renderTasks();
}

// Keep stats synchronized
function updateStats() {
    document.getElementById('statTotal').textContent      = allTasks.length;
    document.getElementById('statTodo').textContent       = allTasks.filter(t => t.status_id === 1).length;
    document.getElementById('statInProgress').textContent = allTasks.filter(t => t.status_id === 2).length;
    document.getElementById('statDone').textContent       = allTasks.filter(t => t.status_id === 3).length;
}

function populateProjectSelects() {
    const filterOpts = '<option value="">All Projects</option>' +
        allProjects.map(p => '<option value="' + p.project_id + '">' + escHtml(p.project_name) + '</option>').join('');
    document.getElementById('filter_project').innerHTML = filterOpts;
}

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
