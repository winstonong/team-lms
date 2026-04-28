/* ============================================
   BruntWork LMS — Single Page Application
   ============================================ */

// --- State ---
const state = {
    user: null,
    token: null,
    courses: [],
    currentCourse: null,
    currentLesson: null,
    enrollments: [],
    certificates: [],
    users: [],
    dashboardStats: null,
};

// --- Config ---
const API = '/api';

// --- Helpers ---
function getToken() {
    return state.token || localStorage.getItem('lms_token');
}

function setAuth(user, token) {
    state.user = user;
    state.token = token;
    localStorage.setItem('lms_token', token);
    localStorage.setItem('lms_user', JSON.stringify(user));
}

function clearAuth() {
    state.user = null;
    state.token = null;
    localStorage.removeItem('lms_token');
    localStorage.removeItem('lms_user');
}

function loadAuth() {
    const token = localStorage.getItem('lms_token');
    const user = localStorage.getItem('lms_user');
    if (token && user) {
        state.token = token;
        try { state.user = JSON.parse(user); } catch { clearAuth(); }
    }
}

async function api(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const res = await fetch(`${API}${path}`, { ...options, headers, credentials: 'same-origin' });
        if (res.status === 401) {
            clearAuth();
            navigate('/login');
            throw new Error('Unauthorized');
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
        return data;
    } catch (err) {
        if (err.message !== 'Unauthorized') throw err;
        throw err;
    }
}

function navigate(path) {
    window.location.hash = '#' + path;
}

function getRoute() {
    const hash = window.location.hash.slice(1) || '/login';
    return hash;
}

function matchRoute(pattern, path) {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) return null;
    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
            params[patternParts[i].slice(1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
            return null;
        }
    }
    return params;
}

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
}

function courseGradient(title) {
    const h = Math.abs(hashString(title || 'Course'));
    const hue1 = h % 360;
    const hue2 = (hue1 + 40) % 360;
    return `linear-gradient(135deg, hsl(${hue1}, 70%, 50%) 0%, hsl(${hue2}, 80%, 45%) 100%)`;
}

function userInitials(name) {
    return (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function difficultyBadge(level) {
    const l = (level || 'beginner').toLowerCase();
    return `<span class="badge badge-${l}">${l.charAt(0).toUpperCase() + l.slice(1)}</span>`;
}

function roleBadge(role) {
    const r = (role || 'learner').toLowerCase();
    return `<span class="badge badge-${r}">${r.charAt(0).toUpperCase() + r.slice(1)}</span>`;
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// --- Toast Notifications ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const icons = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i data-lucide="${icons[type] || 'info'}"></i>
        <span>${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()"><i data-lucide="x"></i></button>
    `;
    container.appendChild(toast);
    lucide.createIcons({ nodes: [toast] });
    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- Modal ---
function showModal(title, bodyHtml, footerHtml = '') {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
        <div class="modal modal-lg" onclick="event.stopPropagation()">
            <div class="modal-header">
                <h2>${escapeHtml(title)}</h2>
                <button class="modal-close" onclick="closeModal()"><i data-lucide="x"></i></button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
        </div>
    `;
    lucide.createIcons({ nodes: [overlay] });
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-overlay').innerHTML = '';
}

function confirmDialog(message) {
    return new Promise(resolve => {
        showModal('Confirm', `<p>${escapeHtml(message)}</p>`,
            `<button class="btn btn-secondary" onclick="closeModal(); window._confirmResolve(false)">Cancel</button>
             <button class="btn btn-danger" onclick="closeModal(); window._confirmResolve(true)">Confirm</button>`);
        window._confirmResolve = resolve;
    });
}

// --- Icons helper ---
function icons() {
    try { lucide.createIcons(); } catch {}
}

// --- Render into #app ---
function render(html) {
    document.getElementById('app').innerHTML = html;
    icons();
}

// --- Sidebar Template ---
function sidebarLayout(activeKey, content) {
    if (!state.user) { navigate('/login'); return ''; }
    const u = state.user;
    const isAdmin = u.role === 'admin';
    const isInstructor = u.role === 'instructor' || isAdmin;

    const link = (href, icon, label, key) =>
        `<a class="sidebar-link ${activeKey === key ? 'active' : ''}" href="#${href}">
            <i data-lucide="${icon}"></i> ${label}
        </a>`;

    return `
    <button class="mobile-menu-btn" onclick="document.querySelector('.sidebar').classList.toggle('open'); document.querySelector('.sidebar-overlay').classList.toggle('active')">
        <i data-lucide="menu"></i>
    </button>
    <div class="sidebar-overlay" onclick="document.querySelector('.sidebar').classList.remove('open'); this.classList.remove('active')"></div>
    <div class="layout">
        <aside class="sidebar">
            <div class="sidebar-brand">
                <div class="brand-icon"><i data-lucide="graduation-cap"></i></div>
                <h2>BruntWork LMS</h2>
            </div>
            <nav class="sidebar-nav">
                <div class="sidebar-section-title">Learn</div>
                ${link('/dashboard', 'layout-dashboard', 'Dashboard', 'dashboard')}
                ${link('/courses', 'library', 'Browse Courses', 'courses')}
                ${link('/my/certificates', 'award', 'Certificates', 'certificates')}
                ${isInstructor ? `
                    <div class="sidebar-section-title">Admin</div>
                    ${link('/admin/courses', 'settings', 'Manage Courses', 'admin-courses')}
                    ${link('/admin/progress', 'bar-chart-3', 'Course Progress', 'admin-progress')}
                    ${isAdmin ? link('/admin/users', 'users', 'Manage Users', 'admin-users') : ''}
                    ${isAdmin ? link('/admin/announcements', 'mail', 'Send Email', 'admin-announcements') : ''}
                ` : ''}
            </nav>
            <div class="sidebar-user">
                <div class="sidebar-user-avatar">${userInitials(u.name)}</div>
                <div class="sidebar-user-info">
                    <div class="sidebar-user-name">${escapeHtml(u.name)}</div>
                    <div class="sidebar-user-role">${u.role}</div>
                </div>
                <div class="sidebar-logout" onclick="handleLogout()" title="Log out">
                    <i data-lucide="log-out"></i>
                </div>
            </div>
        </aside>
        <main class="main-content">${content}</main>
    </div>`;
}

// --- Logout ---
function handleLogout() {
    clearAuth();
    navigate('/login');
}

// ============================================
//  Pages
// ============================================

// --- Login ---
function renderLogin() {
    render(`
        <div class="auth-page">
            <div class="auth-card">
                <div class="auth-brand">
                    <div class="brand-icon"><i data-lucide="graduation-cap"></i></div>
                    <h1>BruntWork LMS</h1>
                    <p>Sign in to your learning account</p>
                </div>
                <form id="login-form">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input class="form-input" type="email" id="login-email" placeholder="you@company.com" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input class="form-input" type="password" id="login-password" placeholder="Your password" required>
                    </div>
                    <button class="btn btn-primary btn-block btn-lg" type="submit">Sign In</button>
                </form>
                <div class="auth-footer" style="margin-top:12px">
                    <a href="#/forgot-password">Forgot password?</a>
                </div>
                <div class="auth-footer">
                    Don't have an account? <a href="#/register">Register</a>
                </div>
            </div>
        </div>
    `);
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Signing in...';
        try {
            const data = await api('/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    email: document.getElementById('login-email').value,
                    password: document.getElementById('login-password').value,
                }),
            });
            setAuth(data.user, data.token);
            showToast('Welcome back, ' + data.user.name + '!');
            navigate('/dashboard');
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    });
}

// --- Register ---
function renderRegister() {
    render(`
        <div class="auth-page">
            <div class="auth-card">
                <div class="auth-brand">
                    <div class="brand-icon"><i data-lucide="graduation-cap"></i></div>
                    <h1>Create Account</h1>
                    <p>Start your learning journey today</p>
                </div>
                <form id="register-form">
                    <div class="form-group">
                        <label class="form-label">Full Name</label>
                        <input class="form-input" type="text" id="reg-name" placeholder="John Smith" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input class="form-input" type="email" id="reg-email" placeholder="you@company.com" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input class="form-input" type="password" id="reg-password" placeholder="Min 6 characters" required minlength="6">
                    </div>
                    <button class="btn btn-primary btn-block btn-lg" type="submit">Create Account</button>
                </form>
                <div class="auth-footer">
                    Already have an account? <a href="#/login">Sign In</a>
                </div>
            </div>
        </div>
    `);
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Creating account...';
        try {
            const data = await api('/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    name: document.getElementById('reg-name').value,
                    email: document.getElementById('reg-email').value,
                    password: document.getElementById('reg-password').value,
                }),
            });
            setAuth(data.user, data.token);
            showToast('Welcome, ' + data.user.name + '!');
            navigate('/dashboard');
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Create Account';
        }
    });
}

// --- Forgot Password ---
function renderForgotPassword() {
    render(`
        <div class="auth-page">
            <div class="auth-card">
                <div class="auth-brand">
                    <div class="brand-icon"><i data-lucide="key-round"></i></div>
                    <h1>Forgot password</h1>
                    <p>Enter your email and we'll send you a reset link</p>
                </div>
                <form id="forgot-form">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input class="form-input" type="email" id="forgot-email" placeholder="you@company.com" required>
                    </div>
                    <button class="btn btn-primary btn-block btn-lg" type="submit">Send reset link</button>
                </form>
                <div class="auth-footer">
                    <a href="#/login">Back to sign in</a>
                </div>
            </div>
        </div>
    `);
    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Sending...';
        try {
            const data = await api('/auth/forgot-password', {
                method: 'POST',
                body: JSON.stringify({ email: document.getElementById('forgot-email').value }),
            });
            showToast(data.message || 'If an account exists, a reset link has been sent.');
            btn.disabled = false;
            btn.textContent = 'Send reset link';
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Send reset link';
        }
    });
}

// --- Reset Password ---
function renderResetPassword(token) {
    render(`
        <div class="auth-page">
            <div class="auth-card">
                <div class="auth-brand">
                    <div class="brand-icon"><i data-lucide="lock"></i></div>
                    <h1>Set a new password</h1>
                    <p>Choose a strong password (min 6 characters)</p>
                </div>
                <form id="reset-form">
                    <div class="form-group">
                        <label class="form-label">New password</label>
                        <input class="form-input" type="password" id="reset-password" required minlength="6">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Confirm password</label>
                        <input class="form-input" type="password" id="reset-confirm" required minlength="6">
                    </div>
                    <button class="btn btn-primary btn-block btn-lg" type="submit">Update password</button>
                </form>
                <div class="auth-footer">
                    <a href="#/login">Back to sign in</a>
                </div>
            </div>
        </div>
    `);
    document.getElementById('reset-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = document.getElementById('reset-password').value;
        const confirm = document.getElementById('reset-confirm').value;
        if (pw !== confirm) { showToast("Passwords don't match", 'error'); return; }
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Updating...';
        try {
            await api('/auth/reset-password', {
                method: 'POST',
                body: JSON.stringify({ token, password: pw }),
            });
            showToast('Password updated. Please sign in.');
            navigate('/login');
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Update password';
        }
    });
}

// --- Dashboard ---
async function renderDashboard() {
    render(sidebarLayout('dashboard', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading dashboard...</p></div>`));
    try {
        const [statsData, enrollmentsData] = await Promise.all([
            api('/dashboard/stats'),
            api('/my/enrollments'),
        ]);
        state.enrollments = enrollmentsData.enrollments || enrollmentsData || [];
        const stats = statsData.stats || statsData;

        const inProgress = state.enrollments.filter(e => e.progress < 100);

        const content = `
            <div class="page-header">
                <h1>Welcome back, ${escapeHtml(state.user.name)}!</h1>
                <p>Here's an overview of your learning progress</p>
            </div>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue"><i data-lucide="book-open"></i></div>
                    <div class="stat-info">
                        <h4>Enrolled Courses</h4>
                        <div class="stat-value">${stats.total_enrollments || 0}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green"><i data-lucide="check-circle"></i></div>
                    <div class="stat-info">
                        <h4>Completed</h4>
                        <div class="stat-value">${stats.total_completions || 0}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon yellow"><i data-lucide="clock"></i></div>
                    <div class="stat-info">
                        <h4>In Progress</h4>
                        <div class="stat-value">${(stats.total_enrollments || 0) - (stats.total_completions || 0)}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon cyan"><i data-lucide="award"></i></div>
                    <div class="stat-info">
                        <h4>Certificates</h4>
                        <div class="stat-value">${stats.total_certificates || 0}</div>
                    </div>
                </div>
            </div>

            ${inProgress.length > 0 ? `
                <div class="card">
                    <div class="card-header"><h3>Continue Learning</h3></div>
                    <div class="card-body">
                        <div class="continue-grid">
                            ${inProgress.slice(0, 4).map(e => `
                                <div class="continue-card" onclick="navigate('/courses/${e.courseId}')">
                                    <div class="continue-card-thumb" style="background: ${courseGradient(e.courseTitle)}">
                                        <i data-lucide="play-circle"></i>
                                    </div>
                                    <div class="continue-card-info">
                                        <h4>${escapeHtml(e.courseTitle)}</h4>
                                        <div class="progress-label"><span>${Math.round(e.progress)}% complete</span></div>
                                        <div class="progress-bar"><div class="progress-bar-fill" style="width:${e.progress}%"></div></div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            ` : `
                <div class="card">
                    <div class="card-body">
                        <div class="empty-state">
                            <i data-lucide="book-open"></i>
                            <h3>No courses in progress</h3>
                            <p>Browse our course catalog to start learning!</p>
                            <a href="#/courses" class="btn btn-primary"><i data-lucide="library"></i> Browse Courses</a>
                        </div>
                    </div>
                </div>
            `}
        `;
        render(sidebarLayout('dashboard', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Browse Courses ---
async function renderCourses() {
    render(sidebarLayout('courses', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading courses...</p></div>`));
    try {
        const data = await api('/courses');
        state.courses = data.courses || data || [];

        renderCourseList();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderCourseList(search = '', category = '') {
    let courses = state.courses.filter(c => c.status === 'published' || !c.status);
    if (search) {
        const s = search.toLowerCase();
        courses = courses.filter(c => (c.title || '').toLowerCase().includes(s) || (c.description || '').toLowerCase().includes(s));
    }
    if (category) {
        courses = courses.filter(c => c.category === category);
    }

    const categories = [...new Set(state.courses.map(c => c.category).filter(Boolean))];

    const content = `
        <div class="page-header">
            <h1>Browse Courses</h1>
            <p>Explore our course catalog and start learning</p>
        </div>
        <div class="course-filters">
            <div class="search-input-wrapper">
                <i data-lucide="search"></i>
                <input class="form-input" type="text" placeholder="Search courses..." id="course-search" value="${escapeHtml(search)}" oninput="handleCourseFilter()">
            </div>
            <select class="form-select" id="course-category" onchange="handleCourseFilter()" style="width:auto; min-width: 160px;">
                <option value="">All Categories</option>
                ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
        </div>
        ${courses.length === 0 ? `
            <div class="empty-state">
                <i data-lucide="search"></i>
                <h3>No courses found</h3>
                <p>Try adjusting your search or filters</p>
            </div>
        ` : `
            <div class="courses-grid">
                ${courses.map(c => `
                    <div class="course-card" onclick="navigate('/courses/${c.id}')">
                        <div class="course-card-thumb" style="background: ${courseGradient(c.title)}">
                            <i data-lucide="book-open"></i>
                        </div>
                        <div class="course-card-body">
                            <h3>${escapeHtml(c.title)}</h3>
                            <div class="course-card-meta">
                                ${difficultyBadge(c.difficulty)}
                                <span><i data-lucide="layers"></i> ${c.lesson_count ?? (c.lessons || []).length} lessons</span>
                                <span><i data-lucide="users"></i> ${c.enrollment_count ?? c.enrolledCount ?? 0} enrolled</span>
                            </div>
                            <p style="font-size:0.85rem; color: var(--text-secondary); margin:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
                                ${escapeHtml((c.description || '').slice(0, 120))}
                            </p>
                        </div>
                        <div class="course-card-footer">
                            <span class="course-card-instructor"><i data-lucide="user"></i> ${escapeHtml(c.instructorName || 'Instructor')}</span>
                            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); handleEnroll(${c.id})">Enroll</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `}
    `;
    render(sidebarLayout('courses', content));
}

function handleCourseFilter() {
    const search = document.getElementById('course-search')?.value || '';
    const category = document.getElementById('course-category')?.value || '';
    renderCourseList(search, category);
}

async function handleEnroll(courseId) {
    try {
        await api(`/courses/${courseId}/enroll`, { method: 'POST' });
        showToast('Successfully enrolled!');
        navigate('/courses/' + courseId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Course Detail ---
async function renderCourseDetail(courseId) {
    render(sidebarLayout('courses', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading course...</p></div>`));
    try {
        const data = await api(`/courses/${courseId}`);
        state.currentCourse = data.course || data;
        const c = state.currentCourse;
        const enrollment = c.enrollment || null;
        const lessons = data.lessons || c.lessons || [];
        c.lessons = lessons;
        const progress = enrollment ? enrollment.progress || 0 : 0;
        const completedLessons = enrollment ? (enrollment.completedLessons || []) : [];
        const isInstructor = state.user && (state.user.role === 'admin' || state.user.role === 'instructor');

        const nextLesson = lessons.find(l => !completedLessons.includes(l.id));

        const content = `
            <div class="course-detail-header" style="background: ${courseGradient(c.title)}">
                <a href="#/courses" style="color:rgba(255,255,255,0.7); font-size:0.85rem; display:inline-flex; align-items:center; gap:4px; margin-bottom:12px;">
                    <i data-lucide="arrow-left" style="width:16px;height:16px"></i> Back to courses
                </a>
                <h1>${escapeHtml(c.title)}</h1>
                <p>${escapeHtml(c.description || '')}</p>
                <div class="course-detail-meta">
                    <span><i data-lucide="user"></i> ${escapeHtml(c.instructorName || 'Instructor')}</span>
                    <span>${difficultyBadge(c.difficulty)}</span>
                    <span><i data-lucide="layers"></i> ${lessons.length} lessons</span>
                    <span><i data-lucide="users"></i> ${c.enrolledCount || 0} enrolled</span>
                    ${c.category ? `<span><i data-lucide="tag"></i> ${escapeHtml(c.category)}</span>` : ''}
                </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 320px; gap: 24px;">
                <div class="card">
                    <div class="card-header">
                        <h3>Course Content</h3>
                        ${isInstructor ? `<a href="#/admin/courses" class="btn btn-sm btn-secondary"><i data-lucide="edit"></i> Edit</a>` : ''}
                    </div>
                    <div class="card-body" style="padding:0">
                        ${lessons.length === 0 ? '<div class="empty-state"><p>No lessons yet</p></div>' :
                        lessons.map((l, i) => {
                            const done = completedLessons.includes(l.id);
                            return `
                            <div style="display:flex; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid var(--border-light); cursor:pointer;" onclick="navigate('/courses/${courseId}/learn/${l.id}')">
                                <div class="lesson-check ${done ? 'done' : ''}">
                                    ${done ? '<i data-lucide="check"></i>' : `<span style="font-size:0.75rem; color:var(--text-muted)">${i + 1}</span>`}
                                </div>
                                <div style="flex:1">
                                    <div style="font-weight:500; font-size:0.9rem;">${escapeHtml(l.title)}</div>
                                    ${l.duration ? `<div style="font-size:0.78rem; color:var(--text-muted)">${l.duration} min</div>` : ''}
                                </div>
                                ${l.quiz ? '<span class="badge badge-intermediate" style="font-size:0.65rem">Quiz</span>' : ''}
                            </div>`;
                        }).join('')}
                    </div>
                </div>

                <div>
                    <div class="card" style="position:sticky; top:32px;">
                        <div class="card-body" style="text-align:center;">
                            ${enrollment ? `
                                <div class="progress-label"><span>Progress</span><span>${Math.round(progress)}%</span></div>
                                <div class="progress-bar" style="margin-bottom:20px"><div class="progress-bar-fill ${progress >= 100 ? 'green' : ''}" style="width:${progress}%"></div></div>
                                ${nextLesson ? `
                                    <a href="#/courses/${courseId}/learn/${nextLesson.id}" class="btn btn-primary btn-block btn-lg">
                                        <i data-lucide="play"></i> ${progress > 0 ? 'Continue Learning' : 'Start Course'}
                                    </a>
                                ` : `
                                    <div style="color:var(--success); font-weight:600; margin-bottom:12px;">
                                        <i data-lucide="check-circle" style="width:24px;height:24px;vertical-align:middle"></i> Course Complete!
                                    </div>
                                `}
                            ` : `
                                <p style="color:var(--text-secondary); margin-bottom:16px; font-size:0.9rem;">Enroll to start learning</p>
                                <button class="btn btn-primary btn-block btn-lg" onclick="handleEnroll(${courseId})">
                                    <i data-lucide="plus-circle"></i> Enroll Now
                                </button>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;
        render(sidebarLayout('courses', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Lesson Viewer ---
async function renderLesson(courseId, lessonId) {
    render(sidebarLayout('courses', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading lesson...</p></div>`));
    try {
        const data = await api(`/courses/${courseId}`);
        state.currentCourse = data.course || data;
        const c = state.currentCourse;
        const lessons = data.lessons || c.lessons || [];
        c.lessons = lessons;
        const enrollment = c.enrollment || {};
        const completedLessons = enrollment.completedLessons || [];
        const progress = enrollment.progress || 0;
        // Fetch individual lesson detail (includes quiz data)
        let lesson = lessons.find(l => String(l.id) === String(lessonId));
        if (!lesson) { showToast('Lesson not found', 'error'); navigate('/courses/' + courseId); return; }
        try {
            const lessonDetail = await api(`/courses/${courseId}/lessons/${lessonId}`);
            lesson = lessonDetail.lesson || lessonDetail;
        } catch(e) {}

        const lessonIndex = lessons.indexOf(lesson);
        const prevLesson = lessons[lessonIndex - 1];
        const nextLesson = lessons[lessonIndex + 1];
        const isComplete = completedLessons.includes(lesson.id);

        state.currentLesson = lesson;
        state._quizMode = false;

        const content = `
            <div class="lesson-layout">
                <div class="lesson-sidebar">
                    <div class="lesson-sidebar-header">
                        <a href="#/courses/${courseId}" style="font-size:0.8rem; display:inline-flex; align-items:center; gap:4px; margin-bottom:8px; color:var(--text-secondary)">
                            <i data-lucide="arrow-left" style="width:14px;height:14px"></i> Back to course
                        </a>
                        <h3>${escapeHtml(c.title)}</h3>
                        <div class="progress-label"><span>${Math.round(progress)}% complete</span></div>
                        <div class="progress-bar"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
                    </div>
                    <div class="lesson-list">
                        ${lessons.map((l, i) => {
                            const done = completedLessons.includes(l.id);
                            const active = String(l.id) === String(lessonId);
                            return `
                            <div class="lesson-list-item ${active ? 'active' : ''} ${done ? 'completed' : ''}" onclick="navigate('/courses/${courseId}/learn/${l.id}')">
                                <div class="lesson-check ${done ? 'done' : ''}">
                                    ${done ? '<i data-lucide="check"></i>' : `<span style="font-size:0.7rem">${i + 1}</span>`}
                                </div>
                                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(l.title)}</span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
                <div class="lesson-main" id="lesson-content-area">
                    <h1>${escapeHtml(lesson.title)}</h1>
                    ${lesson.duration ? `<div class="lesson-duration"><i data-lucide="clock"></i> ${lesson.duration} minutes</div>` : ''}
                    <div class="lesson-content">${lesson.content || '<p>No content yet.</p>'}</div>
                    <div class="lesson-actions">
                        <div>
                            ${prevLesson ? `<a href="#/courses/${courseId}/learn/${prevLesson.id}" class="btn btn-secondary"><i data-lucide="chevron-left"></i> Previous</a>` : ''}
                        </div>
                        <div style="display:flex; gap:10px; align-items:center;">
                            ${!isComplete ? `
                                <button class="btn btn-success" onclick="handleMarkComplete(${courseId}, ${lesson.id})">
                                    <i data-lucide="check"></i> Mark as Complete
                                </button>
                            ` : `
                                <span style="color:var(--success); font-weight:600; display:flex; align-items:center; gap:6px;">
                                    <i data-lucide="check-circle"></i> Completed
                                </span>
                            `}
                            ${lesson.quiz && isComplete ? `
                                <button class="btn btn-primary" onclick="showQuiz(${courseId}, ${lesson.id})">
                                    <i data-lucide="file-question"></i> Take Quiz
                                </button>
                            ` : ''}
                            ${nextLesson ? `<a href="#/courses/${courseId}/learn/${nextLesson.id}" class="btn btn-primary">Next <i data-lucide="chevron-right"></i></a>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
        render(sidebarLayout('courses', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleMarkComplete(courseId, lessonId) {
    try {
        await api(`/courses/${courseId}/lessons/${lessonId}/complete`, { method: 'POST' });
        showToast('Lesson completed!');
        renderLesson(courseId, lessonId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Quiz ---
function showQuiz(courseId, lessonId) {
    const lesson = state.currentLesson;
    if (!lesson || !lesson.quiz) return;
    const quiz = lesson.quiz;
    const questions = quiz.questions || [];

    const area = document.getElementById('lesson-content-area');
    if (!area) return;

    area.innerHTML = `
        <div class="quiz-container">
            <div class="quiz-header">
                <h2>Quiz: ${escapeHtml(lesson.title)}</h2>
                <p>Passing score: ${quiz.passingScore || 70}% &middot; ${questions.length} questions</p>
            </div>
            <form id="quiz-form">
                ${questions.map((q, qi) => `
                    <div class="quiz-question">
                        <div class="quiz-question-number">Question ${qi + 1}</div>
                        <h4>${escapeHtml(q.question)}</h4>
                        <div class="quiz-options">
                            ${(q.options || []).map((opt, oi) => `
                                <label class="quiz-option" data-q="${qi}" data-o="${oi}" onclick="selectQuizOption(this, ${qi})">
                                    <div class="quiz-radio"></div>
                                    <span>${escapeHtml(opt)}</span>
                                    <input type="radio" name="q${qi}" value="${oi}" style="display:none">
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
                <button class="btn btn-primary btn-lg" type="submit" style="margin-top:12px">
                    <i data-lucide="send"></i> Submit Answers
                </button>
            </form>
        </div>
    `;
    icons();

    document.getElementById('quiz-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const answers = {};
        questions.forEach((q, qi) => {
            const checked = document.querySelector(`input[name="q${qi}"]:checked`);
            if (checked) answers[qi] = parseInt(checked.value);
        });

        try {
            const result = await api(`/quizzes/${quiz.id}/submit`, {
                method: 'POST',
                body: JSON.stringify({ answers }),
            });
            showQuizResults(result, questions, answers, courseId, lessonId);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function selectQuizOption(el, qi) {
    document.querySelectorAll(`.quiz-option[data-q="${qi}"]`).forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    el.querySelector('input').checked = true;
}

function showQuizResults(result, questions, answers, courseId, lessonId) {
    const area = document.getElementById('lesson-content-area');
    if (!area) return;
    const passed = result.passed;
    const score = result.score;

    area.innerHTML = `
        <div class="quiz-container">
            <div class="quiz-results">
                <i data-lucide="${passed ? 'trophy' : 'alert-circle'}" style="width:64px;height:64px;color:${passed ? 'var(--success)' : 'var(--danger)'}"></i>
                <div class="quiz-score ${passed ? 'pass' : 'fail'}">${Math.round(score)}%</div>
                <h2>${passed ? 'Congratulations! You passed!' : 'Not quite. Keep studying!'}</h2>
                <p style="color:var(--text-secondary)">${result.correct || 0} out of ${questions.length} correct</p>
                <div style="margin-top:20px; display:flex; gap:12px; justify-content:center;">
                    ${!passed ? `<button class="btn btn-primary" onclick="showQuiz(${courseId}, ${lessonId})"><i data-lucide="refresh-cw"></i> Retry</button>` : ''}
                    <a href="#/courses/${courseId}" class="btn btn-secondary">Back to Course</a>
                </div>
            </div>

            <div style="margin-top:32px;">
                <h3 style="margin-bottom:16px;">Review Answers</h3>
                ${questions.map((q, qi) => {
                    const userAns = answers[qi];
                    const correctAns = result.correctAnswers ? result.correctAnswers[qi] : q.correctAnswer;
                    return `
                    <div class="quiz-question">
                        <div class="quiz-question-number">Question ${qi + 1}</div>
                        <h4>${escapeHtml(q.question)}</h4>
                        <div class="quiz-options">
                            ${(q.options || []).map((opt, oi) => {
                                let cls = '';
                                if (oi === correctAns) cls = 'correct';
                                else if (oi === userAns && oi !== correctAns) cls = 'incorrect';
                                return `<div class="quiz-option ${cls}"><div class="quiz-radio"></div><span>${escapeHtml(opt)}</span></div>`;
                            }).join('')}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>
    `;
    icons();
}

// --- Certificates List ---
async function renderCertificates() {
    render(sidebarLayout('certificates', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading certificates...</p></div>`));
    try {
        const data = await api('/my/certificates');
        state.certificates = data.certificates || data || [];

        const content = `
            <div class="page-header">
                <h1>My Certificates</h1>
                <p>Certificates you've earned by completing courses</p>
            </div>
            ${state.certificates.length === 0 ? `
                <div class="card"><div class="card-body">
                    <div class="empty-state">
                        <i data-lucide="award"></i>
                        <h3>No certificates yet</h3>
                        <p>Complete courses to earn certificates!</p>
                        <a href="#/courses" class="btn btn-primary">Browse Courses</a>
                    </div>
                </div></div>
            ` : `
                <div class="certificates-grid">
                    ${state.certificates.map(cert => `
                        <div class="certificate-card" onclick="navigate('/certificates/${cert.code}')">
                            <div class="certificate-card-icon"><i data-lucide="award"></i></div>
                            <h3>${escapeHtml(cert.courseTitle)}</h3>
                            <p>Issued ${formatDate(cert.issuedAt)}</p>
                            <p style="font-family:monospace; font-size:0.75rem; color:var(--text-muted)">${cert.code}</p>
                        </div>
                    `).join('')}
                </div>
            `}
        `;
        render(sidebarLayout('certificates', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Certificate View ---
async function renderCertificateView(code) {
    render(sidebarLayout('certificates', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading certificate...</p></div>`));
    try {
        const data = await api(`/certificates/${code}`);
        const cert = data.certificate || data;

        const content = `
            <div style="margin-bottom:12px;">
                <a href="#/my/certificates" style="font-size:0.85rem; display:inline-flex; align-items:center; gap:4px; color:var(--text-secondary)">
                    <i data-lucide="arrow-left" style="width:16px;height:16px"></i> Back to certificates
                </a>
            </div>
            <div class="certificate-wrapper">
                <div class="certificate">
                    <div class="certificate-icon"><i data-lucide="award"></i></div>
                    <div class="certificate-subtitle">Certificate of Completion</div>
                    <h1>BruntWork LMS</h1>
                    <div class="certificate-text">This is to certify that</div>
                    <div class="certificate-name">${escapeHtml(cert.userName || state.user?.name || '')}</div>
                    <div class="certificate-text">has successfully completed the course</div>
                    <div class="certificate-course">${escapeHtml(cert.courseTitle)}</div>
                    <div class="certificate-date">Issued on ${formatDate(cert.issuedAt)}</div>
                    <div class="certificate-code">Certificate ID: ${escapeHtml(cert.code)}</div>
                    <div class="certificate-actions">
                        <button class="btn btn-primary" onclick="window.print()"><i data-lucide="printer"></i> Print Certificate</button>
                    </div>
                </div>
            </div>
        `;
        render(sidebarLayout('certificates', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Admin: Manage Courses ---
async function renderAdminCourses() {
    render(sidebarLayout('admin-courses', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading courses...</p></div>`));
    try {
        const data = await api('/courses');
        const courses = data.courses || data || [];

        const content = `
            <div class="page-header page-header-actions">
                <div>
                    <h1>Manage Courses</h1>
                    <p>Create and manage your course content</p>
                </div>
                <button class="btn btn-primary" onclick="openCourseEditor()"><i data-lucide="plus"></i> New Course</button>
            </div>
            <div class="card">
                <div class="table-wrapper">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Title</th>
                                <th>Category</th>
                                <th>Difficulty</th>
                                <th>Lessons</th>
                                <th>Enrolled</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${courses.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-secondary)">No courses yet. Create your first course!</td></tr>' :
                            courses.map(c => `
                                <tr>
                                    <td style="font-weight:600">${escapeHtml(c.title)}</td>
                                    <td>${escapeHtml(c.category || '-')}</td>
                                    <td>${difficultyBadge(c.difficulty)}</td>
                                    <td>${c.lesson_count ?? (c.lessons || []).length}</td>
                                    <td>${c.enrollment_count ?? c.enrolledCount ?? 0}</td>
                                    <td><span class="badge badge-${c.status === 'published' ? 'published' : 'draft'}">${c.status || 'draft'}</span></td>
                                    <td>
                                        <div class="table-actions">
                                            <button class="btn btn-sm btn-secondary" onclick="openCourseEditor(${c.id})"><i data-lucide="edit"></i></button>
                                            <button class="btn btn-sm btn-danger" onclick="handleDeleteCourse(${c.id})"><i data-lucide="trash-2"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        render(sidebarLayout('admin-courses', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Course Editor Modal
async function openCourseEditor(courseId) {
    let course = { title: '', description: '', category: '', difficulty: 'beginner', status: 'draft', lessons: [] };
    if (courseId) {
        try {
            const data = await api(`/courses/${courseId}`);
            course = data.course || {};
            // Attach lessons (the API returns them alongside the course, not nested)
            const lessons = data.lessons || [];
            // Fetch quizzes for each lesson (so editor shows existing quiz questions)
            course.lessons = await Promise.all(lessons.map(async (l) => {
                const lesson = {
                    id: l.id,
                    title: l.title || '',
                    content: l.content || '',
                    duration: l.duration_minutes || '',
                    quiz: null,
                };
                try {
                    const qd = await api(`/courses/${courseId}/lessons/${l.id}`);
                    if (qd && qd.quiz) {
                        lesson.quiz = {
                            passingScore: qd.quiz.passing_score || 70,
                            questions: (qd.questions || []).map(q => ({
                                question: q.question_text,
                                options: q.options || ['', '', '', ''],
                                correctAnswer: parseInt(q.correct_answer) || 0,
                            })),
                        };
                    }
                } catch (e) { /* lesson may not have quiz */ }
                return lesson;
            }));
        } catch (err) {
            showToast(err.message, 'error');
            return;
        }
    }

    window._editorCourse = JSON.parse(JSON.stringify(course));
    window._editorCourseId = courseId || null;
    window._quillEditors = {};
    renderCourseEditorModal();
    initLessonRichTextEditors();
}

function renderCourseEditorModal() {
    const c = window._editorCourse;
    const isEdit = !!window._editorCourseId;

    const body = `
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">Course Title</label>
                <input class="form-input" id="ce-title" value="${escapeHtml(c.title)}" placeholder="e.g. Introduction to Project Management">
            </div>
            <div class="form-group">
                <label class="form-label">Category</label>
                <input class="form-input" id="ce-category" value="${escapeHtml(c.category || '')}" placeholder="e.g. Leadership, Technical">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">Description</label>
            <textarea class="form-textarea" id="ce-description" placeholder="What will learners gain from this course?">${escapeHtml(c.description || '')}</textarea>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">Difficulty</label>
                <select class="form-select" id="ce-difficulty">
                    <option value="beginner" ${c.difficulty === 'beginner' ? 'selected' : ''}>Beginner</option>
                    <option value="intermediate" ${c.difficulty === 'intermediate' ? 'selected' : ''}>Intermediate</option>
                    <option value="advanced" ${c.difficulty === 'advanced' ? 'selected' : ''}>Advanced</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Status</label>
                <select class="form-select" id="ce-status">
                    <option value="draft" ${c.status === 'draft' ? 'selected' : ''}>Draft</option>
                    <option value="published" ${c.status === 'published' ? 'selected' : ''}>Published</option>
                </select>
            </div>
        </div>

        <h3 style="margin:20px 0 12px; display:flex; align-items:center; justify-content:space-between;">
            Lessons
            <button class="btn btn-sm btn-secondary" onclick="addEditorLesson()"><i data-lucide="plus"></i> Add Lesson</button>
        </h3>
        <div id="ce-lessons">
            ${(c.lessons || []).map((l, li) => lessonEditorHtml(l, li)).join('')}
        </div>
    `;

    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveCourseEditor()"><i data-lucide="save"></i> ${isEdit ? 'Update' : 'Create'} Course</button>
    `;

    showModal((isEdit ? 'Edit' : 'New') + ' Course', body, footer);
}

function lessonEditorHtml(lesson, index) {
    return `
        <div class="lesson-item-editor" data-index="${index}">
            <div class="lesson-item-header">
                <span class="drag-handle"><i data-lucide="grip-vertical"></i></span>
                <h4>Lesson ${index + 1}</h4>
                <button class="btn btn-sm btn-ghost" onclick="removeEditorLesson(${index})" title="Remove lesson"><i data-lucide="trash-2"></i></button>
                <button class="btn btn-sm btn-ghost" onclick="toggleLessonDetail(${index})" title="Toggle details"><i data-lucide="chevron-down"></i></button>
            </div>
            <div class="lesson-detail" id="lesson-detail-${index}">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Title</label>
                        <input class="form-input le-title" value="${escapeHtml(lesson.title || '')}" placeholder="Lesson title">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Duration (min)</label>
                        <input class="form-input le-duration" type="number" value="${lesson.duration || ''}" placeholder="15">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Content</label>
                    <div class="le-content-editor" data-lesson-index="${index}" data-initial="${encodeURIComponent(lesson.content || '')}"></div>
                </div>
                <div style="margin-top:12px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="checkbox" class="le-has-quiz" ${lesson.quiz ? 'checked' : ''} onchange="toggleQuizEditor(${index}, this.checked)">
                        <span class="form-label" style="margin:0">Add Quiz</span>
                    </label>
                    <div id="quiz-editor-${index}" style="${lesson.quiz ? '' : 'display:none;'} margin-top:12px;">
                        <div class="form-group">
                            <label class="form-label">Passing Score (%)</label>
                            <input class="form-input le-passing-score" type="number" value="${lesson.quiz?.passingScore || 70}" min="0" max="100" style="max-width:120px">
                        </div>
                        <div id="quiz-questions-${index}">
                            ${(lesson.quiz?.questions || []).map((q, qi) => questionEditorHtml(index, qi, q)).join('')}
                        </div>
                        <button class="btn btn-sm btn-secondary" onclick="addQuizQuestion(${index})" style="margin-top:8px"><i data-lucide="plus"></i> Add Question</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function questionEditorHtml(lessonIndex, qIndex, question = { question: '', options: ['', '', '', ''], correctAnswer: 0 }) {
    return `
        <div class="question-editor" data-li="${lessonIndex}" data-qi="${qIndex}">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <strong style="font-size:0.85rem">Question ${qIndex + 1}</strong>
                <button class="btn btn-sm btn-ghost" onclick="removeQuizQuestion(${lessonIndex}, ${qIndex})"><i data-lucide="trash-2"></i></button>
            </div>
            <div class="form-group">
                <input class="form-input qe-question" value="${escapeHtml(question.question)}" placeholder="Enter question text">
            </div>
            ${(question.options || []).map((opt, oi) => `
                <div class="option-row">
                    <input type="radio" name="correct-${lessonIndex}-${qIndex}" value="${oi}" ${oi === question.correctAnswer ? 'checked' : ''}>
                    <input class="form-input qe-option" value="${escapeHtml(opt)}" placeholder="Option ${oi + 1}" style="flex:1">
                </div>
            `).join('')}
        </div>
    `;
}

function initLessonRichTextEditors() {
    if (typeof Quill === 'undefined') return;
    window._quillEditors = window._quillEditors || {};
    document.querySelectorAll('.le-content-editor').forEach(el => {
        const idx = el.getAttribute('data-lesson-index');
        if (el.dataset.quillReady === '1') return;
        const initial = decodeURIComponent(el.getAttribute('data-initial') || '');
        const quill = new Quill(el, {
            theme: 'snow',
            placeholder: 'Write lesson content here...',
            modules: {
                toolbar: [
                    [{ header: [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ color: [] }, { background: [] }],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    ['blockquote', 'code-block'],
                    ['link', 'image', 'video'],
                    [{ align: [] }],
                    ['clean']
                ]
            }
        });
        if (initial) quill.clipboard.dangerouslyPasteHTML(initial);
        el.dataset.quillReady = '1';
        window._quillEditors[idx] = quill;
    });
}

function addEditorLesson() {
    syncEditorState();
    window._editorCourse.lessons = window._editorCourse.lessons || [];
    window._editorCourse.lessons.push({ title: '', content: '', duration: '', quiz: null });
    renderCourseEditorModal();
    initLessonRichTextEditors();
}

function removeEditorLesson(index) {
    syncEditorState();
    window._editorCourse.lessons.splice(index, 1);
    renderCourseEditorModal();
    initLessonRichTextEditors();
}

function toggleLessonDetail(index) {
    const el = document.getElementById('lesson-detail-' + index);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function toggleQuizEditor(index, show) {
    const el = document.getElementById('quiz-editor-' + index);
    if (el) el.style.display = show ? '' : 'none';
}

function addQuizQuestion(lessonIndex) {
    syncEditorState();
    const lesson = window._editorCourse.lessons[lessonIndex];
    if (!lesson.quiz) lesson.quiz = { passingScore: 70, questions: [] };
    lesson.quiz.questions.push({ question: '', options: ['', '', '', ''], correctAnswer: 0 });
    renderCourseEditorModal();
    initLessonRichTextEditors();
}

function removeQuizQuestion(lessonIndex, qIndex) {
    syncEditorState();
    window._editorCourse.lessons[lessonIndex].quiz.questions.splice(qIndex, 1);
    renderCourseEditorModal();
    initLessonRichTextEditors();
}

function syncEditorState() {
    const c = window._editorCourse;
    c.title = document.getElementById('ce-title')?.value || c.title;
    c.category = document.getElementById('ce-category')?.value || c.category;
    c.description = document.getElementById('ce-description')?.value || c.description;
    c.difficulty = document.getElementById('ce-difficulty')?.value || c.difficulty;
    c.status = document.getElementById('ce-status')?.value || c.status;

    const lessonEls = document.querySelectorAll('.lesson-item-editor');
    lessonEls.forEach((el, i) => {
        if (!c.lessons[i]) return;
        c.lessons[i].title = el.querySelector('.le-title')?.value || '';
        c.lessons[i].duration = parseInt(el.querySelector('.le-duration')?.value) || null;
        const quill = window._quillEditors && window._quillEditors[i];
        if (quill) {
            const html = quill.root.innerHTML;
            // Treat empty <p><br></p> as empty
            c.lessons[i].content = (html === '<p><br></p>') ? '' : html;
        }

        const hasQuiz = el.querySelector('.le-has-quiz')?.checked;
        if (hasQuiz) {
            if (!c.lessons[i].quiz) c.lessons[i].quiz = { passingScore: 70, questions: [] };
            c.lessons[i].quiz.passingScore = parseInt(el.querySelector('.le-passing-score')?.value) || 70;

            const qEls = el.querySelectorAll('.question-editor');
            c.lessons[i].quiz.questions = [];
            qEls.forEach((qEl) => {
                const q = {
                    question: qEl.querySelector('.qe-question')?.value || '',
                    options: Array.from(qEl.querySelectorAll('.qe-option')).map(o => o.value),
                    correctAnswer: parseInt(qEl.querySelector('input[type=radio]:checked')?.value) || 0,
                };
                c.lessons[i].quiz.questions.push(q);
            });
        } else {
            c.lessons[i].quiz = null;
        }
    });
}

async function saveCourseEditor() {
    syncEditorState();
    const c = window._editorCourse;
    const isEdit = !!window._editorCourseId;

    // Frontend validation: course title + every lesson title
    if (!c.title || !c.title.trim()) {
        showToast('Course title is required', 'error');
        return;
    }
    const blank = (c.lessons || [])
        .map((l, i) => ({ i: i + 1, title: (l && l.title || '').trim() }))
        .filter(x => !x.title);
    if (blank.length) {
        showToast(`Lesson ${blank.map(b => b.i).join(', ')} is missing a title`, 'error');
        return;
    }

    try {
        if (isEdit) {
            await api(`/courses/${window._editorCourseId}`, { method: 'PUT', body: JSON.stringify(c) });
            showToast('Course updated!');
        } else {
            await api('/courses', { method: 'POST', body: JSON.stringify(c) });
            showToast('Course created!');
        }
        closeModal();
        renderAdminCourses();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleDeleteCourse(id) {
    const ok = await confirmDialog('Are you sure you want to delete this course? This cannot be undone.');
    if (!ok) return;
    try {
        await api(`/courses/${id}`, { method: 'DELETE' });
        showToast('Course deleted');
        renderAdminCourses();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Admin: Course Progress (overview) ---
async function renderAdminProgress() {
    render(sidebarLayout('admin-progress', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading progress...</p></div>`));
    try {
        const data = await api('/admin/progress/overview');
        const courses = data.courses || [];

        const totalEnrolled = courses.reduce((s, c) => s + c.total_enrolled, 0);
        const totalCompleted = courses.reduce((s, c) => s + c.total_completed, 0);
        const overallRate = totalEnrolled === 0 ? 0 : Math.round((totalCompleted / totalEnrolled) * 100);

        const content = `
            <div class="page-header">
                <h1>Course Progress</h1>
                <p>Track enrolment and completion across every course</p>
            </div>
            <div class="stats-grid" style="margin-bottom:24px">
                <div class="stat-card"><div class="stat-icon blue"><i data-lucide="users"></i></div><div><h4>Total Enrolments</h4><div class="stat-value">${totalEnrolled}</div></div></div>
                <div class="stat-card"><div class="stat-icon green"><i data-lucide="check-circle-2"></i></div><div><h4>Completions</h4><div class="stat-value">${totalCompleted}</div></div></div>
                <div class="stat-card"><div class="stat-icon cyan"><i data-lucide="percent"></i></div><div><h4>Overall Completion Rate</h4><div class="stat-value">${overallRate}%</div></div></div>
            </div>
            <div class="card">
                <div class="table-wrapper">
                    <table class="table">
                        <thead><tr>
                            <th>Course</th>
                            <th>Status</th>
                            <th>Lessons</th>
                            <th>Enrolled</th>
                            <th>Completed</th>
                            <th>Completion Rate</th>
                            <th>Actions</th>
                        </tr></thead>
                        <tbody>
                            ${courses.length === 0 ? `<tr><td colspan="7" style="text-align:center; color:var(--text-secondary); padding:32px">No courses yet</td></tr>` :
                              courses.map(c => `
                                <tr>
                                    <td style="font-weight:500">${escapeHtml(c.title)}</td>
                                    <td><span class="badge badge-${c.status === 'published' ? 'published' : 'draft'}">${c.status}</span></td>
                                    <td>${c.total_lessons}</td>
                                    <td>${c.total_enrolled}</td>
                                    <td>${c.total_completed}</td>
                                    <td>
                                        <div style="display:flex; align-items:center; gap:8px">
                                            <div style="flex:1; max-width:120px; height:8px; background:var(--border); border-radius:4px; overflow:hidden">
                                                <div style="height:100%; width:${c.completion_rate}%; background:var(--success)"></div>
                                            </div>
                                            <span style="font-weight:500; min-width:40px">${c.completion_rate}%</span>
                                        </div>
                                    </td>
                                    <td>
                                        <button class="btn btn-sm btn-secondary" onclick="navigate('/admin/progress/${c.id}')">
                                            <i data-lucide="users"></i> View Learners
                                        </button>
                                    </td>
                                </tr>
                              `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        render(sidebarLayout('admin-progress', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Admin: Course Progress (per-course detail) ---
async function renderAdminCourseProgress(courseId) {
    render(sidebarLayout('admin-progress', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading learners...</p></div>`));
    try {
        const data = await api(`/admin/courses/${courseId}/progress`);
        const c = data.course;
        const s = data.summary;
        const enrollments = data.enrollments || [];

        const content = `
            <div class="page-header">
                <div>
                    <a href="#/admin/progress" style="color:var(--text-secondary); text-decoration:none; font-size:0.85rem; display:inline-flex; align-items:center; gap:4px; margin-bottom:8px">
                        <i data-lucide="arrow-left" style="width:14px; height:14px"></i> Back to all courses
                    </a>
                    <h1>${escapeHtml(c.title)}</h1>
                    <p>${data.total_lessons} lessons · <span class="badge badge-${c.status === 'published' ? 'published' : 'draft'}">${c.status}</span></p>
                </div>
            </div>
            <div class="stats-grid" style="margin-bottom:24px">
                <div class="stat-card"><div class="stat-icon blue"><i data-lucide="users"></i></div><div><h4>Enrolled</h4><div class="stat-value">${s.total_enrolled}</div></div></div>
                <div class="stat-card"><div class="stat-icon green"><i data-lucide="check-circle-2"></i></div><div><h4>Completed</h4><div class="stat-value">${s.total_completed}</div></div></div>
                <div class="stat-card"><div class="stat-icon yellow"><i data-lucide="clock"></i></div><div><h4>In Progress</h4><div class="stat-value">${s.total_in_progress}</div></div></div>
                <div class="stat-card"><div class="stat-icon cyan"><i data-lucide="percent"></i></div><div><h4>Avg Progress</h4><div class="stat-value">${s.average_progress}%</div></div></div>
            </div>
            <div class="card">
                <div class="table-wrapper">
                    <table class="table">
                        <thead><tr>
                            <th>Learner</th>
                            <th>Email</th>
                            <th>Enrolled</th>
                            <th>Lessons Completed</th>
                            <th>Progress</th>
                            <th>Quizzes Passed</th>
                            <th>Status</th>
                            <th>Completed On</th>
                        </tr></thead>
                        <tbody>
                            ${enrollments.length === 0 ? `<tr><td colspan="8" style="text-align:center; color:var(--text-secondary); padding:32px">No one is enrolled yet</td></tr>` :
                              enrollments.map(e => `
                                <tr>
                                    <td style="font-weight:500">${escapeHtml(e.user_name)}</td>
                                    <td style="color:var(--text-secondary)">${escapeHtml(e.user_email)}</td>
                                    <td style="color:var(--text-secondary)">${formatDate(e.enrolled_at)}</td>
                                    <td>${e.lessons_completed} / ${e.total_lessons}</td>
                                    <td>
                                        <div style="display:flex; align-items:center; gap:8px">
                                            <div style="flex:1; max-width:100px; height:6px; background:var(--border); border-radius:3px; overflow:hidden">
                                                <div style="height:100%; width:${e.progress_percent}%; background:var(--primary)"></div>
                                            </div>
                                            <span style="font-weight:500; min-width:40px; font-size:0.85rem">${e.progress_percent}%</span>
                                        </div>
                                    </td>
                                    <td>${e.quizzes_passed}</td>
                                    <td>
                                        ${e.is_completed
                                            ? '<span class="badge badge-published">Completed</span>'
                                            : (e.lessons_completed > 0
                                                ? '<span class="badge badge-warning">In Progress</span>'
                                                : '<span class="badge badge-draft">Not Started</span>')}
                                    </td>
                                    <td style="color:var(--text-secondary)">${e.completed_at ? formatDate(e.completed_at) : '—'}</td>
                                </tr>
                              `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        render(sidebarLayout('admin-progress', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Admin: Send Announcement ---
async function renderAdminAnnouncements() {
    render(sidebarLayout('admin-announcements', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading...</p></div>`));
    try {
        const data = await api('/courses');
        const courses = data.courses || [];

        const content = `
            <div class="page-header">
                <h1>Send Email</h1>
                <p>Send a one-off email to your team. Requires Resend to be configured.</p>
            </div>
            <div class="card" style="max-width:760px">
                <form id="announce-form" style="padding:24px">
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Audience</label>
                            <select class="form-select" id="ann-audience">
                                <option value="all">Everyone (all users)</option>
                                <option value="learners">Learners only</option>
                                <option value="enrolled">Learners enrolled in a specific course</option>
                            </select>
                        </div>
                        <div class="form-group" id="ann-course-group" style="display:none">
                            <label class="form-label">Course</label>
                            <select class="form-select" id="ann-course">
                                ${courses.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Subject</label>
                        <input class="form-input" id="ann-subject" placeholder="e.g. New course available: Onboarding 101" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Message (HTML allowed)</label>
                        <textarea class="form-textarea" id="ann-message" rows="8" placeholder="Hi team,&#10;&#10;Write your announcement here..." required></textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Button label (optional)</label>
                            <input class="form-input" id="ann-action-label" placeholder="View course">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Button URL (optional)</label>
                            <input class="form-input" id="ann-action-url" placeholder="https://...">
                        </div>
                    </div>
                    <div style="margin-top:16px; display:flex; gap:12px">
                        <button class="btn btn-primary" type="submit"><i data-lucide="send"></i> Send</button>
                        <button class="btn btn-secondary" type="button" id="ann-test"><i data-lucide="mail-check"></i> Send test to me</button>
                    </div>
                </form>
                <div id="ann-result" style="padding:0 24px 24px"></div>
            </div>
        `;
        render(sidebarLayout('admin-announcements', content));

        document.getElementById('ann-audience').addEventListener('change', (e) => {
            document.getElementById('ann-course-group').style.display = e.target.value === 'enrolled' ? '' : 'none';
        });

        async function send(payloadOverride = {}) {
            const subject = document.getElementById('ann-subject').value.trim();
            const message = document.getElementById('ann-message').value.trim();
            if (!subject || !message) { showToast('Subject and message are required', 'error'); return; }
            const audience = document.getElementById('ann-audience').value;
            const course_id = document.getElementById('ann-course')?.value;
            const action_label = document.getElementById('ann-action-label').value.trim() || undefined;
            const action_url = document.getElementById('ann-action-url').value.trim() || undefined;
            const messageHtml = message.startsWith('<') ? message : message.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

            const body = {
                subject, message: messageHtml,
                audience, course_id,
                action_label, action_url,
                ...payloadOverride,
            };
            try {
                const result = await api('/admin/announcements', { method: 'POST', body: JSON.stringify(body) });
                document.getElementById('ann-result').innerHTML = `
                    <div class="card" style="padding:14px; border-left:4px solid var(--success); background:var(--success-light); color:#065f46">
                        Sent ${result.sent} of ${result.total} ${result.failed ? `(${result.failed} failed)` : ''}
                    </div>`;
                showToast(`Sent ${result.sent} email${result.sent === 1 ? '' : 's'}`);
            } catch (err) {
                showToast(err.message, 'error');
            }
        }

        document.getElementById('announce-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
        document.getElementById('ann-test').addEventListener('click', () => {
            // Override audience to send only to current admin
            send({ audience: 'self' });
        });

        lucide.createIcons();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// --- Admin: Manage Users ---
async function renderAdminUsers() {
    render(sidebarLayout('admin-users', `<div class="loading-page"><div class="spinner spinner-lg"></div><p>Loading users...</p></div>`));
    try {
        const data = await api('/users');
        state.users = data.users || data || [];

        const content = `
            <div class="page-header">
                <h1>Manage Users</h1>
                <p>View and manage user roles across the platform</p>
            </div>
            <div class="card">
                <div class="table-wrapper">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Joined</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${state.users.map(u => `
                                <tr>
                                    <td style="font-weight:500">${escapeHtml(u.name)}</td>
                                    <td style="color:var(--text-secondary)">${escapeHtml(u.email)}</td>
                                    <td>${roleBadge(u.role)}</td>
                                    <td style="color:var(--text-secondary)">${formatDate(u.createdAt)}</td>
                                    <td>
                                        <select class="form-select" style="width:auto; min-width:130px; padding:6px 30px 6px 10px; font-size:0.82rem;" onchange="handleChangeRole(${u.id}, this.value)">
                                            <option value="learner" ${u.role === 'learner' ? 'selected' : ''}>Learner</option>
                                            <option value="instructor" ${u.role === 'instructor' ? 'selected' : ''}>Instructor</option>
                                            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                                        </select>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        render(sidebarLayout('admin-users', content));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleChangeRole(userId, role) {
    try {
        await api(`/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
        showToast('Role updated');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================
//  Router
// ============================================

const routes = [
    { pattern: '/login', handler: () => renderLogin() },
    { pattern: '/register', handler: () => renderRegister() },
    { pattern: '/forgot-password', handler: () => renderForgotPassword() },
    { pattern: '/reset-password/:token', handler: (p) => renderResetPassword(p.token) },
    { pattern: '/dashboard', handler: () => renderDashboard() },
    { pattern: '/courses', handler: () => renderCourses() },
    { pattern: '/courses/:id', handler: (p) => renderCourseDetail(p.id) },
    { pattern: '/courses/:id/learn/:lessonId', handler: (p) => renderLesson(p.id, p.lessonId) },
    { pattern: '/my/certificates', handler: () => renderCertificates() },
    { pattern: '/certificates/:code', handler: (p) => renderCertificateView(p.code) },
    { pattern: '/admin/courses', handler: () => renderAdminCourses() },
    { pattern: '/admin/progress', handler: () => renderAdminProgress() },
    { pattern: '/admin/progress/:courseId', handler: (p) => renderAdminCourseProgress(p.courseId) },
    { pattern: '/admin/users', handler: () => renderAdminUsers() },
    { pattern: '/admin/announcements', handler: () => renderAdminAnnouncements() },
];

function routeHandler() {
    const path = getRoute();
    loadAuth();

    // Auth guard
    const publicRoutes = ['/login', '/register', '/forgot-password'];
    const isPublic = publicRoutes.includes(path) || path.startsWith('/reset-password/');
    if (!state.user && !isPublic) {
        navigate('/login');
        return;
    }
    if (state.user && isPublic) {
        navigate('/dashboard');
        return;
    }

    // Admin guard
    if (path.startsWith('/admin')) {
        if (!state.user || (state.user.role !== 'admin' && state.user.role !== 'instructor')) {
            showToast('Access denied', 'error');
            navigate('/dashboard');
            return;
        }
        if (path === '/admin/users' && state.user.role !== 'admin') {
            showToast('Admin only', 'error');
            navigate('/dashboard');
            return;
        }
    }

    for (const route of routes) {
        const params = matchRoute(route.pattern, path);
        if (params !== null) {
            route.handler(params);
            return;
        }
    }

    // 404 fallback
    if (state.user) {
        navigate('/dashboard');
    } else {
        navigate('/login');
    }
}

window.addEventListener('hashchange', routeHandler);
window.addEventListener('load', () => {
    if (!window.location.hash) window.location.hash = '#/login';
    routeHandler();
});

// Make helpers globally available for inline onclick handlers
window.navigate = navigate;
window.handleEnroll = handleEnroll;
window.handleMarkComplete = handleMarkComplete;
window.showQuiz = showQuiz;
window.selectQuizOption = selectQuizOption;
window.openCourseEditor = openCourseEditor;
window.addEditorLesson = addEditorLesson;
window.removeEditorLesson = removeEditorLesson;
window.toggleLessonDetail = toggleLessonDetail;
window.toggleQuizEditor = toggleQuizEditor;
window.addQuizQuestion = addQuizQuestion;
window.removeQuizQuestion = removeQuizQuestion;
window.saveCourseEditor = saveCourseEditor;
window.handleDeleteCourse = handleDeleteCourse;
window.handleChangeRole = handleChangeRole;
window.handleLogout = handleLogout;
window.closeModal = closeModal;
window.handleCourseFilter = handleCourseFilter;
