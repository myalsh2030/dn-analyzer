/* =========================================================
   بيانات الحرمان للمتدربين | (مستمر) محروم بجميع المقررات | محروم إلا مقرر | محروم إلا مقررين - SF01
   الكلية التقنية بعنيزة
   ========================================================= */

const App = (() => {
    'use strict';

    // ===== الحالة العامة =====
    const state = {
        rawRows: [],
        semester: '',
        collegeName: '',
        trainees: {},          // traineeId -> { id, name, phone, spec, dept, status, courses: Map }
        departments: {},       // deptName -> Set of specializations
        originalDepts: new Set(),  // أقسام من التقرير الأصلي
        addedDepts: new Set(),     // أقسام أضافها المستخدم
        allKnownSpecs: new Set(),  // جميع التخصصات المعروفة (لا تُحذف أبداً)
        instructors: {},       // instructorName -> { dept, spec }
        deptSpecMapping: {},   // spec -> dept (editable)
        deptPhones: {},        // deptName -> phone string (WhatsApp)
        deprivedAll: [],
        deprivedExceptOne: [],
        deprivedExceptTwo: [],
        stats: [],
        charts: {},
        reportDate: null      // تاريخ تحميل/رفع التقرير (ISO string)
    };

    let _ageInterval = null;  // مؤقت تحديث عمر التقرير

    const STORAGE_KEY = 'sf01_deprivation_data';
    const EXCLUDED_STATUSES = ['انسحاب فصلي', 'منقطع أسبوعين', 'مطوي قيده'];

    // ===== أسماء أعمدة CSV =====
    const COL = {
        SEMESTER: 'الفصل التدريبي',
        UNIT: 'الوحدة',
        STAGE: 'المرحلة',
        DEPT: 'القسم',
        SPEC: 'التخصص',
        COURSE: 'المقرر',
        COURSE_NAME: 'اسم المقرر',
        REF: 'الرقم المرجعي',
        SCHEDULE: 'نوع الجدولة',
        HOURS: 'الساعات المعتمدة',
        INSTRUCTOR: 'المدرب',
        TRAINEE_ID: 'رقم المتدرب',
        TRAINEE_NAME: 'إسم المتدرب',
        STAGE2: 'مرحلة',
        REG_STATUS: 'حالة تسجيل',
        TRAINEE_STATUS: 'حالة المتدرب',
        TRAINING_TYPE: 'نوع التدريب',
        PROGRAM: 'برنامج',
        PHONE: 'رقم الجوال',
        GRADE: 'الدرجة'
    };

    const GENERAL_DEPT = 'الدراسات العامة';

    // ===== الإعدادات الافتراضية لكلية عنيزة =====
    const UNAIZAH_COLLEGE_NAME = 'الكلية التقنية بعنيزة';
    const UNAIZAH_DEFAULTS = {
        'التقنية الميكانيكية': ['صيانة الآلات الميكانيكية'],
        'التقنية الكهربائية': ['تقنية الآلات كهربائية', 'تقنية القوى كهربائية'],
        'التقنية المدنية والمعمارية': ['تقنية الانشاءات المعمارية', 'تقنية الانشاءات المدنية'],
        'التقنية الالكترونية': ['تقنية أجهزة وآلات دقيقة'],
        'تقنية الكهرباء والكترونيات المركبات': ['تقنية الكهرباء والكترونيات الم'],
        'تقنية المساحة': ['تقنية المساحة']
    };

    function isUnaizahCollege(name) {
        return name && name.trim() === 'كلية عنيزة';
    }

    function applyUnaizahDefaults() {
        // 1. تصحيح اسم الكلية
        state.collegeName = UNAIZAH_COLLEGE_NAME;

        // 2. بناء خريطة: تخصص → القسم الصحيح
        const correctMapping = {};
        Object.entries(UNAIZAH_DEFAULTS).forEach(([dept, specs]) => {
            specs.forEach(spec => { correctMapping[spec] = dept; });
        });

        // 3. إزالة التخصصات من أقسامها الخاطئة ونقلها للأقسام الصحيحة
        Object.entries(correctMapping).forEach(([spec, correctDept]) => {
            // إزالة من جميع الأقسام الحالية
            Object.keys(state.departments).forEach(dept => {
                if (dept !== correctDept && state.departments[dept] instanceof Set) {
                    state.departments[dept].delete(spec);
                }
            });

            // إضافة للقسم الصحيح
            if (!state.departments[correctDept]) state.departments[correctDept] = new Set();
            state.departments[correctDept].add(spec);
            state.originalDepts.add(correctDept);

            // تحديث الـ mapping
            state.deptSpecMapping[spec] = correctDept;
        });

        // 4. تتبع الأقسام الجديدة التي لم تكن في التقرير الأصلي
        ['تقنية الكهرباء والكترونيات المركبات', 'تقنية المساحة'].forEach(dept => {
            if (!state.originalDepts.has(dept)) {
                // لا نضيفها لـ addedDepts لأنها افتراضية وليست مضافة من المستخدم
                state.originalDepts.add(dept);
            }
        });
    }

    // ===== التهيئة =====
    function init() {
        setupUpload();
        setupCollegeAutoSave();
        // loadFromStorage أصبحت async لأن IndexedDB غير متزامن
        loadFromStorage().catch(e => console.warn('فشل تحميل البيانات:', e));
        // إعادة رسم لوحة التنظيم عند فتح التبويب
        const mappingTab = document.getElementById('tabMappingLink');
        if (mappingTab) {
            mappingTab.addEventListener('shown.bs.tab', () => renderMappingBoard());
        }
    }

    function setupUpload() {
        const zone = document.getElementById('uploadZone');
        const input = document.getElementById('csvFileInput');
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('dragover');
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });
        input.addEventListener('change', e => {
            if (e.target.files.length) handleFile(e.target.files[0]);
        });
    }

    function handleFile(file) {
        if (!file.name.toLowerCase().endsWith('.csv')) {
            alert('الرجاء رفع ملف بصيغة CSV فقط.');
            return;
        }
        document.getElementById('uploadZone').classList.add('d-none');
        document.getElementById('uploadProgress').classList.remove('d-none');

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            encoding: 'UTF-8',
            complete: results => {
                setTimeout(() => {
                    processData(results.data);
                    // تعيين تاريخ التقرير من تاريخ تعديل الملف (file.lastModified)
                    state.reportDate = new Date(file.lastModified).toISOString();
                    // استعادة الإعدادات المحفوظة (تنظيم الأقسام) بعد معالجة الملف الجديد
                    try {
                        const settingsRaw = localStorage.getItem(SETTINGS_KEY);
                        if (settingsRaw) {
                            const savedSettings = JSON.parse(settingsRaw);
                            applySettings(savedSettings);
                            if (savedSettings.collegeName) state.collegeName = savedSettings.collegeName;
                        }
                    } catch (_) { /* ignore */ }
                    saveToStorage();
                    showApp('mapping');
                }, 400);
            },
            error: () => alert('حدث خطأ في قراءة الملف.')
        });
    }

    // ===== معالجة البيانات =====
    function processData(rows) {
        state.rawRows = rows;
        state.trainees = {};
        state.departments = {};
        state.originalDepts = new Set();
        state.allKnownSpecs = new Set();
        state.instructors = {};
        state.deptSpecMapping = {};

        if (!rows.length) return;

        // 1. الفصل التدريبي واسم الكلية
        state.semester = (rows[0][COL.SEMESTER] || '').trim();
        state.collegeName = (rows[0][COL.UNIT] || '').trim();

        // 2. فلترة الصفوف: استبعاد 0 ساعات
        const filtered = rows.filter(r => {
            const hours = parseInt(r[COL.HOURS], 10);
            return !isNaN(hours) && hours > 0;
        });

        // 3. بناء خريطة المتدربين
        filtered.forEach(row => {
            const tid = (row[COL.TRAINEE_ID] || '').trim();
            if (!tid) return;

            const regStatus = (row[COL.REG_STATUS] || '').trim();
            const traineeStatus = (row[COL.TRAINEE_STATUS] || '').trim();
            const spec = (row[COL.SPEC] || '').trim();
            const dept = (row[COL.DEPT] || '').trim();
            const courseCode = (row[COL.COURSE] || '').trim();
            const courseName = (row[COL.COURSE_NAME] || '').trim();

            // تحديد حالة المتدرب
            let status;
            if (regStatus === 'انسحاب فصلي') status = 'انسحاب فصلي';
            else if (regStatus === 'مطوي قيده لإنقطاع أسبوعين') status = 'منقطع أسبوعين';
            else status = traineeStatus || 'مستمر';

            // إنشاء أو تحديث المتدرب
            if (!state.trainees[tid]) {
                state.trainees[tid] = {
                    id: tid,
                    name: (row[COL.TRAINEE_NAME] || '').trim(),
                    phone: (row[COL.PHONE] || '').trim(),
                    spec: spec,
                    dept: dept,
                    status: status,
                    courses: new Map()
                };
            }

            // حالة المتدرب - استخدام أول ظهور لحالة استبعاد
            const t = state.trainees[tid];
            if (EXCLUDED_STATUSES.includes(status) && !EXCLUDED_STATUSES.includes(t.status)) {
                t.status = status;
            }

            // إضافة المقرر
            const isDeprived = regStatus === 'حرمان بسبب غياب';
            const courseKey = courseCode;
            if (!t.courses.has(courseKey)) {
                t.courses.set(courseKey, {
                    code: courseCode,
                    name: courseName,
                    ref: (row[COL.REF] || '').trim(),
                    schedule: (row[COL.SCHEDULE] || '').trim(),
                    instructor: (row[COL.INSTRUCTOR] || '').trim(),
                    dept: dept,
                    deprived: isDeprived
                });
            } else if (isDeprived) {
                t.courses.get(courseKey).deprived = true;
            }

            // 5. حصر المدربين
            const instructor = (row[COL.INSTRUCTOR] || '').trim();
            if (instructor && !state.instructors[instructor]) {
                if (dept === GENERAL_DEPT) {
                    state.instructors[instructor] = { dept: GENERAL_DEPT, spec: null };
                } else {
                    state.instructors[instructor] = { dept: dept, spec: spec };
                }
            }

            // 6. ربط التخصصات بالأقسام
            if (dept !== GENERAL_DEPT && spec) {
                state.allKnownSpecs.add(spec);
                if (!state.deptSpecMapping[spec]) {
                    state.deptSpecMapping[spec] = dept;
                }
                if (!state.departments[dept]) state.departments[dept] = new Set();
                state.departments[dept].add(spec);
                state.originalDepts.add(dept);
            }
            if (!state.departments[GENERAL_DEPT]) state.departments[GENERAL_DEPT] = new Set();
            state.originalDepts.add(GENERAL_DEPT);
        });

        // ===== تطبيق الإعدادات الافتراضية حسب الكلية =====
        if (isUnaizahCollege(state.collegeName)) {
            applyUnaizahDefaults();
        }

        calculateDeprivation();
        calculateStats();
    }

    // ===== حساب الحرمان =====
    function calculateDeprivation() {
        state.deprivedAll = [];
        state.deprivedExceptOne = [];
        state.deprivedExceptTwo = [];

        Object.values(state.trainees).forEach(t => {
            // استبعاد الحالات الخاصة
            if (EXCLUDED_STATUSES.includes(t.status)) return;

            const totalCourses = t.courses.size;
            if (totalCourses === 0) return;

            let deprivedCount = 0;
            const nonDeprivedCourses = [];

            t.courses.forEach((course, key) => {
                if (course.deprived) deprivedCount++;
                else nonDeprivedCourses.push(course);
            });

            if (deprivedCount === totalCourses) {
                // محروم بجميع المقررات
                state.deprivedAll.push(t);
            } else if (deprivedCount === totalCourses - 1 && totalCourses > 1) {
                // محروم بجميع المقررات إلا مقرر
                state.deprivedExceptOne.push({
                    trainee: t,
                    remainingCourse: nonDeprivedCourses[0]
                });
            } else if (deprivedCount === totalCourses - 2 && totalCourses > 2) {
                // محروم بجميع المقررات إلا مقررين
                state.deprivedExceptTwo.push({
                    trainee: t,
                    remainingCourses: nonDeprivedCourses.slice(0, 2)
                });
            }
        });
    }

    // ===== حساب الإحصائيات =====
    function calculateStats() {
        state.stats = [];
        // تجميع حسب القسم والتخصص
        const map = {};

        Object.values(state.trainees).forEach(t => {
            const dept = state.deptSpecMapping[t.spec] || t.dept || 'غير محدد';
            const spec = t.spec || 'غير محدد';
            const key = `${dept}|||${spec}`;
            if (!map[key]) {
                map[key] = {
                    dept, spec,
                    total: 0,
                    semesterWithdrawal: 0,
                    twoWeekAbsence: 0,
                    enrolled: 0,
                    deprivedAll: 0,
                    deprivedExceptOne: 0,
                    deprivedExceptTwo: 0
                };
            }
            const s = map[key];
            s.total++;
            if (t.status === 'انسحاب فصلي') s.semesterWithdrawal++;
            else if (t.status === 'منقطع أسبوعين') s.twoWeekAbsence++;
            else if (t.status === 'مطوي قيده') s.enrolled++;
        });

        // حساب المحرومين لكل مجموعة
        state.deprivedAll.forEach(t => {
            const dept = state.deptSpecMapping[t.spec] || t.dept || 'غير محدد';
            const spec = t.spec || 'غير محدد';
            const key = `${dept}|||${spec}`;
            if (map[key]) map[key].deprivedAll++;
        });
        state.deprivedExceptOne.forEach(({ trainee: t }) => {
            const dept = state.deptSpecMapping[t.spec] || t.dept || 'غير محدد';
            const spec = t.spec || 'غير محدد';
            const key = `${dept}|||${spec}`;
            if (map[key]) map[key].deprivedExceptOne++;
        });
        state.deprivedExceptTwo.forEach(({ trainee: t }) => {
            const dept = state.deptSpecMapping[t.spec] || t.dept || 'غير محدد';
            const spec = t.spec || 'غير محدد';
            const key = `${dept}|||${spec}`;
            if (map[key]) map[key].deprivedExceptTwo++;
        });

        state.stats = Object.values(map).sort((a, b) => a.dept.localeCompare(b.dept, 'ar') || a.spec.localeCompare(b.spec, 'ar'));
    }

    // ===== عرض التطبيق =====
    function showApp(activeTab = 'summary') {
        document.getElementById('uploadScreen').classList.add('d-none');
        document.getElementById('mainApp').classList.remove('d-none');
        document.getElementById('topSemester').textContent = state.semester;
        document.getElementById('topCollege').textContent = state.collegeName;
        document.getElementById('settingsCollege').value = state.collegeName;
        // عرض تاريخ التقرير
        showReportDateUI();
        calculateDeprivation();
        calculateStats();
        populateFilters();
        renderSummary();
        renderDepAll();
        renderDepOne();
        renderDepTwo();

        // تفعيل التبويب المطلوب
        if (activeTab === 'mapping') {
            const tab = document.getElementById('tabMappingLink');
            if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
            renderMappingBoard();
        } else {
            const tab = document.getElementById('tabSummaryLink');
            if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
        }
    }

    function populateFilters() {
        const depts = Object.keys(state.departments).sort((a, b) => a.localeCompare(b, 'ar'));
        ['filterDepAll', 'filterDepOne', 'filterDepTwo'].forEach(id => {
            const sel = document.getElementById(id);
            sel.innerHTML = '<option value="">جميع الأقسام</option>';
            depts.forEach(d => {
                sel.innerHTML += `<option value="${d}">${d}</option>`;
            });
        });
    }

    // ===== عرض الملخص الإحصائي =====
    let percentMode = 'none'; // 'none' | 'spec' | 'college'

    function setPercentMode(mode) {
        percentMode = mode;
        // تحديث حالة الأزرار
        document.querySelectorAll('#pctToggleGroup .pct-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        renderSummary();
    }

    // دالة مساعدة: حساب وعرض النسبة المئوية
    function pctBadge(value, total, mode) {
        if (!value || !total || mode === 'none') return '';
        const pct = ((value / total) * 100);
        const pctStr = pct < 1 && pct > 0 ? pct.toFixed(1) : Math.round(pct);
        const cls = mode === 'spec' ? 'pct-spec' : 'pct-college';
        return ` <span class="pct-badge ${cls}">(${pctStr}%)</span>`;
    }

    function renderSummary() {
        const c = document.getElementById('summaryTableContainer');
        const totalTrainees = Object.keys(state.trainees).length;
        const totalActive = Object.values(state.trainees).filter(t => !EXCLUDED_STATUSES.includes(t.status)).length;

        // حساب إجماليات الكلية (لوضع النسبة الكلية)
        const collegeTotals = state.stats.reduce((acc, s) => {
            acc.total += s.total || 0;
            acc.sw += s.semesterWithdrawal || 0;
            acc.tw += s.twoWeekAbsence || 0;
            acc.en += s.enrolled || 0;
            acc.da += s.deprivedAll || 0;
            acc.d1 += s.deprivedExceptOne || 0;
            acc.d2 += s.deprivedExceptTwo || 0;
            return acc;
        }, { total: 0, sw: 0, tw: 0, en: 0, da: 0, d1: 0, d2: 0 });

        // بطاقات الإحصائيات
        const cardPct = (val, category) => {
            if (percentMode === 'none') return '';
            if (percentMode === 'spec') {
                // نسبة من إجمالي المتدربين
                return `<div class="stat-pct">${totalTrainees ? Math.round((val / totalTrainees) * 100) : 0}% من الإجمالي</div>`;
            }
            // college - لا معنى لها في البطاقات العلوية
            return '';
        };

        // حساب الحالات الحرجة جداً (متبقي مقررين من نفس المدرب + نسبة الحرمان أكثر من 50%)
        let depTwoAbove50Count = 0;
        let criticalDepTwoCount = 0;
        state.deprivedExceptTwo.forEach(({ trainee, remainingCourses }) => {
            const totalC = trainee.courses.size;
            let depC = 0;
            trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
            if (depC / totalC < 0.5) return;
            
            depTwoAbove50Count++;

            const inst1 = remainingCourses[0].instructor || 'غير محدد';
            const inst2 = remainingCourses[1].instructor || 'غير محدد';
            if (inst1 !== 'غير محدد' && inst1 === inst2) {
                criticalDepTwoCount++;
            }
        });

        let html = `<div class="stat-cards">
            <div class="stat-card" title="إجمالي عدد المتدربين المقيدين في التقرير بمختلف حالاتهم"><div class="stat-value">${totalTrainees}</div><div class="stat-label">إجمالي المتدربين</div></div>
            <div class="stat-card" title="إجمالي المتدربين المستمرين بالتدريب فعلياً&#13;&#10;(استبعد النظام المطوي قيدهم والمنسحبين)"><div class="stat-value">${totalActive}</div><div class="stat-label">المتدربين المستمرين</div>${percentMode !== 'none' ? `<div class="stat-pct">${totalTrainees ? Math.round((totalActive / totalTrainees) * 100) : 0}%</div>` : ''}</div>
            <div class="stat-card" title="المتدربون المستمرون الذين تم حرمانهم في جميع مقرراتهم التدريبية"><div class="stat-value val-danger">${state.deprivedAll.length}</div><div class="stat-label">(مستمر) محروم بجميع المقررات</div>${cardPct(state.deprivedAll.length, 'da')}</div>
            <div class="stat-card" title="متدربون محرومون في كافة مقرراتهم،&#13;&#10;ويتبقى لهم مقرر واحد فقط للرسوب الكلي"><div class="stat-value val-warn">${state.deprivedExceptOne.length}</div><div class="stat-label">محروم إلا مقرر</div>${cardPct(state.deprivedExceptOne.length, 'd1')}</div>
            <div class="stat-card" title="متدربون محرومون في كافة مقرراتهم،&#13;&#10;ويتبقى لهم مقررين اثنين فقط للرسوب الكلي"><div class="stat-value" style="color:var(--secondary)">${state.deprivedExceptTwo.length}</div><div class="stat-label">محروم إلا مقررين</div>${cardPct(state.deprivedExceptTwo.length, 'd2')}</div>
            <div class="stat-card" title="الشروط:&#13;&#10;• متبقي مقررين فقط للرسوب&#13;&#10;• نسبة الحرمان &#8805; 50% من إجمالي جدولهم">
                <div class="stat-value val-danger">${depTwoAbove50Count}</div>
                <div class="stat-label">محروم إلا مقررين</div>
                <div style="font-size: 0.75rem; color: var(--on-surface-variant); text-align: center; margin-top: 4px; font-weight: bold;">(حرمان يتجاوز 49%)</div>
            </div>
            <div class="stat-card" title="الشروط (الحالة الأشد خطورة):&#13;&#10;• متبقي مقررين فقط للرسوب&#13;&#10;• نسبة الحرمان &#8805; 50% من إجمالي جدولهم&#13;&#10;• المقررين المتبقيين يتبعان لنفس المدرب!">
                <div class="stat-value val-danger">${criticalDepTwoCount}</div>
                <div class="stat-label">محروم إلا مقررين</div>
                <div style="font-size: 0.75rem; color: var(--on-surface-variant); text-align: center; margin-top: 4px; font-weight: bold;">(نفس المدرب + تتجاوز 49%)</div>
            </div>
        </div>`;

        html += `<div class="data-table-wrapper" style="border: 2px solid var(--primary);"><table class="data-table">
            <thead style="background:var(--primary);color:#fff;font-weight:800;border-bottom:2px solid var(--secondary);text-align:center"><tr>
                <th style="background:transparent;color:#fff;">القسم</th><th style="background:transparent;color:#fff;">التخصص</th><th style="background:transparent;color:#fff;">العدد الإجمالي</th>
                <th style="background:transparent;color:#fff;">انسحاب فصلي</th><th style="background:transparent;color:#fff;">منقطع أسبوعين</th><th style="background:transparent;color:#fff;">مطوي قيده</th>
                <th style="background:transparent;color:#fff;">(مستمر) محروم بجميع المقررات</th><th style="background:transparent;color:#fff;">محروم إلا مقرر</th><th style="background:transparent;color:#fff;">محروم إلا مقررين</th>
            </tr></thead><tbody>`;

        let currentDept = null;
        let deptRowCount = 0;
        const deptCounts = {};
        state.stats.forEach(s => {
            deptCounts[s.dept] = (deptCounts[s.dept] || 0) + 1;
        });

        state.stats.forEach(s => {
            const isFirstOfDept = s.dept !== currentDept;
            if (isFirstOfDept) {
                currentDept = s.dept;
                deptRowCount = 0;
            }
            deptRowCount++;
            const isLastOfDept = deptRowCount === deptCounts[s.dept];
            const trClass = isLastOfDept ? ' class="dept-last-row"' : '';

            // تحديد مقام النسبة حسب الوضع
            const specTotal = s.total; // إجمالي التخصص
            const base = percentMode === 'spec' ? specTotal : null; // للنسبة التخصصية

            html += `<tr${trClass}>`;
            if (isFirstOfDept) {
                html += `<td rowspan="${deptCounts[s.dept]}" style="vertical-align: middle; font-weight: 800; border-left: 1px solid rgba(192,201,192,0.15); border-bottom: 2px solid var(--outline); background: var(--surface-container);">${s.dept}</td>`;
            }

            // دالة مساعدة محلية لعرض القيمة مع النسبة
            const cellVal = (val, collegeCategoryTotal) => {
                if (!val) return '-';
                if (percentMode === 'spec') {
                    return `<strong>${val}</strong>${pctBadge(val, specTotal, 'spec')}`;
                } else if (percentMode === 'college') {
                    return `<strong>${val}</strong>${pctBadge(val, collegeCategoryTotal, 'college')}`;
                }
                return val;
            };

            html += `<td>${s.spec}</td><td><strong>${s.total}</strong>${percentMode === 'college' ? pctBadge(s.total, collegeTotals.total, 'college') : ''}</td>
                <td>${cellVal(s.semesterWithdrawal, collegeTotals.sw)}</td><td>${cellVal(s.twoWeekAbsence, collegeTotals.tw)}</td><td>${cellVal(s.enrolled, collegeTotals.en)}</td>
                <td class="${s.deprivedAll ? 'val-danger' : ''}">${cellVal(s.deprivedAll, collegeTotals.da)}</td>
                <td class="${s.deprivedExceptOne ? 'val-warn' : ''}">${cellVal(s.deprivedExceptOne, collegeTotals.d1)}</td>
                <td>${cellVal(s.deprivedExceptTwo, collegeTotals.d2)}</td>
            </tr>`;
        });

        html += '</tbody>';

        // صف الإجمالي
        const totals = collegeTotals;
        const totalPctLabel = percentMode === 'spec' ? '' : percentMode === 'college' ? ' <span class="pct-badge pct-college">(100%)</span>' : '';

        html += `<tfoot>
            <tr style="background:var(--primary);color:#fff;font-weight:800;border-top:2px solid var(--secondary);text-align:center">
                <td colspan="2">الإجمالي</td>
                <td>${totals.total}${totalPctLabel}</td>
                <td>${totals.sw || '-'}${totals.sw && percentMode === 'college' ? ' <span class="pct-badge" style="color:rgba(255,255,255,0.7)">(100%)</span>' : ''}</td>
                <td>${totals.tw || '-'}${totals.tw && percentMode === 'college' ? ' <span class="pct-badge" style="color:rgba(255,255,255,0.7)">(100%)</span>' : ''}</td>
                <td>${totals.en || '-'}${totals.en && percentMode === 'college' ? ' <span class="pct-badge" style="color:rgba(255,255,255,0.7)">(100%)</span>' : ''}</td>
                <td>${totals.da || '-'}${totals.da && percentMode === 'college' ? ' <span class="pct-badge" style="color:rgba(255,255,255,0.7)">(100%)</span>' : ''}</td>
                <td>${totals.d1 || '-'}${totals.d1 && percentMode === 'college' ? ' <span class="pct-badge" style="color:rgba(255,255,255,0.7)">(100%)</span>' : ''}</td>
                <td>${totals.d2 || '-'}${totals.d2 && percentMode === 'college' ? ' <span class="pct-badge" style="color:rgba(255,255,255,0.7)">(100%)</span>' : ''}</td>
            </tr>
        </tfoot></table></div>`;

        // === جدول توزيع المحرومين (إلا مقرر) حسب قسم المقرر المتبقي ===
        if (state.deprivedExceptOne.length > 0) {
            const courseDeptMap = {};
            state.deprivedExceptOne.forEach(({ trainee, remainingCourse }) => {
                const courseDept = getDeptForCourse(remainingCourse);
                if (!courseDeptMap[courseDept]) courseDeptMap[courseDept] = 0;
                courseDeptMap[courseDept]++;
            });

            const sortedCourseDepts = Object.entries(courseDeptMap).sort((a, b) => b[1] - a[1]);

            html += `<div style="margin-top:1.5rem;">
                <h5 class="section-title"><i class="bi bi-search"></i> توزيع المحرومين (إلا مقرر) حسب قسم المقرر المتبقي</h5>
                <p style="color:var(--on-surface-variant);font-size:0.8rem;margin-bottom:0.75rem;"><i class="bi bi-info-circle"></i> يُظهر هذا الجدول أي قسم ينتمي إليه المقرر الذي لم يُحرم فيه المتدرب — للكشف عن التساهل المحتمل في التحضير</p>
                <div class="data-table-wrapper" style="border:2px solid var(--secondary);">
                    <table class="data-table">
                        <thead style="background:var(--secondary);color:#fff;font-weight:800;text-align:center"><tr>
                            <th style="background:transparent;color:#fff;">م</th>
                            <th style="background:transparent;color:#fff;">قسم المقرر المتبقي</th>
                            <th style="background:transparent;color:#fff;">عدد المتدربين</th>
                            <th style="background:transparent;color:#fff;">النسبة</th>
                        </tr></thead><tbody>`;

            sortedCourseDepts.forEach(([dept, count], i) => {
                const pct = ((count / state.deprivedExceptOne.length) * 100);
                const pctStr = pct < 1 && pct > 0 ? pct.toFixed(1) : Math.round(pct);
                const isHigh = pct >= 30;
                html += `<tr${isHigh ? ' style="background:rgba(183,29,24,0.06);"' : ''}>
                    <td>${i + 1}</td>
                    <td style="font-weight:700;">${dept}${isHigh ? ' <i class="bi bi-exclamation-triangle-fill" style="color:var(--error);font-size:0.75rem;" title="نسبة مرتفعة"></i>' : ''}</td>
                    <td><strong>${count}</strong></td>
                    <td><span class="pct-badge pct-spec">${pctStr}%</span></td>
                </tr>`;
            });

            html += `</tbody>
                <tfoot><tr style="background:var(--secondary);color:#fff;font-weight:800;text-align:center">
                    <td></td><td>الإجمالي</td>
                    <td>${state.deprivedExceptOne.length}</td>
                    <td>100%</td>
                </tr></tfoot></table></div></div>`;
        }

        c.innerHTML = html;

        // ===== رسم المخطط البياني =====
        renderDeprivationChart(collegeTotals);
    }

    // مرجع للمخطط الحالي
    let deprivationChartInstance = null;

    function renderDeprivationChart(collegeTotals) {
        const canvas = document.getElementById('deprivationChart');
        if (!canvas || typeof Chart === 'undefined') return;

        // تدمير المخطط السابق إن وُجد
        if (deprivationChartInstance) {
            deprivationChartInstance.destroy();
            deprivationChartInstance = null;
        }

        // تجهيز البيانات: تخصص → نسبة محرومين إلا مقرر + نسبة محرومين إلا مقررين (من إجمالي الكلية)
        const labels = [];
        const d1Pcts = [];
        const d2Pcts = [];
        const d1Counts = [];
        const d2Counts = [];

        // فلترة التخصصات التي لديها بيانات فعلية
        const relevantStats = state.stats.filter(s => s.deprivedExceptOne > 0 || s.deprivedExceptTwo > 0);

        if (relevantStats.length === 0) {
            // إخفاء المخطط إذا لم تكن هناك بيانات
            const wrapper = document.getElementById('summaryChartWrapper');
            if (wrapper) wrapper.style.display = 'none';
            return;
        }

        // إظهار المخطط وضبط الارتفاع ديناميكياً
        const wrapper = document.getElementById('summaryChartWrapper');
        if (wrapper) {
            wrapper.style.display = '';
            const chartHeight = Math.max(250, relevantStats.length * 55 + 100);
            wrapper.style.height = chartHeight + 'px';
        }

        relevantStats.forEach(s => {
            labels.push(s.spec);
            const pct1 = collegeTotals.d1 > 0 ? ((s.deprivedExceptOne / collegeTotals.d1) * 100) : 0;
            const pct2 = collegeTotals.d2 > 0 ? ((s.deprivedExceptTwo / collegeTotals.d2) * 100) : 0;
            d1Pcts.push(Math.round(pct1 * 10) / 10);
            d2Pcts.push(Math.round(pct2 * 10) / 10);
            d1Counts.push(s.deprivedExceptOne);
            d2Counts.push(s.deprivedExceptTwo);
        });

        // ألوان من نظام التصميم
        const primaryGreen = '#1a5a3a';
        const goldColor = '#775a19';

        deprivationChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'محروم إلا مقرر واحد',
                        data: d1Pcts,
                        backgroundColor: primaryGreen,
                        borderColor: primaryGreen,
                        borderWidth: 0,
                        borderRadius: 6,
                        borderSkipped: false,
                        barPercentage: 0.7,
                        categoryPercentage: 0.65,
                        _counts: d1Counts
                    },
                    {
                        label: 'محروم إلا مقررين',
                        data: d2Pcts,
                        backgroundColor: goldColor,
                        borderColor: goldColor,
                        borderWidth: 0,
                        borderRadius: 6,
                        borderSkipped: false,
                        barPercentage: 0.7,
                        categoryPercentage: 0.65,
                        _counts: d2Counts
                    }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { left: 10, right: 30, top: 10, bottom: 10 }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'نسب المحرومين حسب التخصص (من إجمالي الكلية)',
                        font: { family: 'Cairo', size: 14, weight: '800' },
                        color: '#191c1c',
                        padding: { bottom: 20 }
                    },
                    legend: {
                        position: 'top',
                        rtl: true,
                        labels: {
                            font: { family: 'Cairo', size: 12, weight: '700' },
                            color: '#404942',
                            usePointStyle: true,
                            pointStyle: 'rectRounded',
                            padding: 20
                        }
                    },
                    tooltip: {
                        rtl: true,
                        textDirection: 'rtl',
                        backgroundColor: 'rgba(25, 28, 28, 0.92)',
                        titleFont: { family: 'Cairo', size: 13, weight: '700' },
                        bodyFont: { family: 'Cairo', size: 12 },
                        cornerRadius: 8,
                        padding: 12,
                        callbacks: {
                            label: function(ctx) {
                                const count = ctx.dataset._counts[ctx.dataIndex];
                                return ` ${ctx.dataset.label}: ${ctx.parsed.x}% (${count} متدرب)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: Math.max(...d1Pcts, ...d2Pcts) + 10,
                        grid: {
                            color: 'rgba(192, 201, 192, 0.15)',
                            drawBorder: false
                        },
                        ticks: {
                            font: { family: 'Cairo', size: 11, weight: '600' },
                            color: '#707972',
                            callback: val => val + '%'
                        },
                        title: {
                            display: true,
                            text: 'النسبة من إجمالي الكلية %',
                            font: { family: 'Cairo', size: 11, weight: '700' },
                            color: '#707972'
                        }
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            font: { family: 'Cairo', size: 11, weight: '700' },
                            color: '#191c1c',
                            mirror: false
                        }
                    }
                }
            }
        });
    }


    // ===== عرض المحرومين بجميع المقررات =====
    function renderDepAll() {
        const filter = document.getElementById('filterDepAll').value;
        const c = document.getElementById('depAllContainer');
        let list = state.deprivedAll;
        if (filter) {
            list = list.filter(t => {
                const dept = state.deptSpecMapping[t.spec] || t.dept;
                return dept === filter;
            });
        }

        // تجميع حسب التخصص
        const grouped = {};
        list.forEach(t => {
            const spec = t.spec || 'غير محدد';
            if (!grouped[spec]) grouped[spec] = [];
            grouped[spec].push(t);
        });

        let html = '';
        if (list.length === 0) {
            html = '<div class="alert alert-success text-center"><i class="bi bi-check-circle"></i> لا يوجد متدربون (مستمرون) محرومون بجميع المقررات</div>';
        } else {
            Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar')).forEach(spec => {
                const trainees = grouped[spec];
                const dept = state.deptSpecMapping[spec] || trainees[0]?.dept || '';
                html += `<div class="data-table-wrapper">
                    <div class="dept-header"><i class="bi bi-mortarboard"></i> ${dept} - ${spec} (${trainees.length})</div>
                    <table class="data-table"><thead><tr>
                        <th>م</th><th>رقم المتدرب</th><th>اسم المتدرب</th><th>رقم الجوال</th><th>التخصص</th><th>القسم</th><th>الحرمان</th>
                    </tr></thead><tbody>`;
                trainees.forEach((t, i) => {
                    const _totalC = t.courses.size;
                    let _depC = 0;
                    t.courses.forEach(c => { if (c.deprived) _depC++; });
                    html += `<tr><td>${i + 1}</td><td>${t.id}</td><td>${t.name}</td><td>${t.phone}</td><td>${t.spec}</td><td>${dept}</td>
                        <td class="dep-ratio-cell"><span class="dep-ratio-num">${_depC}</span> <span class="dep-ratio-sep">/</span> <span class="dep-ratio-den">${_totalC}</span></td></tr>`;
                });
                html += '</tbody></table></div>';
            });
        }
        c.innerHTML = html;
    }

    // ===== عرض المحرومين إلا مقرر =====
    function renderDepOne() {
        const filter = document.getElementById('filterDepOne').value;
        const fiftyBtn = document.getElementById('btnFiftyPercentOne');
        const applyFiftyPct = fiftyBtn && fiftyBtn.classList.contains('active');
        const c = document.getElementById('depOneContainer');
        let list = state.deprivedExceptOne;

        // تجميع حسب قسم المقرر → المدرب
        const grouped = {};
        list.forEach(({ trainee, remainingCourse }) => {
            if (applyFiftyPct) {
                const totalC = trainee.courses.size;
                let depC = 0;
                trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                if (depC / totalC < 0.5) return;
            }
            const courseDept = getDeptForCourse(remainingCourse);
            if (filter && courseDept !== filter) return;
            const instructor = remainingCourse.instructor || 'غير محدد';
            const key = `${courseDept}|||${instructor}`;
            if (!grouped[key]) grouped[key] = { dept: courseDept, instructor, items: [] };
            grouped[key].items.push({ trainee, course: remainingCourse });
        });

        let totalFiltered = 0;
        let html = '';
        if (Object.keys(grouped).length === 0) {
            html = '<div class="alert alert-info text-center"><i class="bi bi-info-circle"></i> لا توجد بيانات</div>';
        } else {
            const byDept = {};
            Object.values(grouped).forEach(g => {
                if (!byDept[g.dept]) byDept[g.dept] = [];
                byDept[g.dept].push(g);
            });
            Object.keys(byDept).sort((a, b) => a.localeCompare(b, 'ar')).forEach(dept => {
                html += `<div class="data-table-wrapper"><div class="dept-header d-flex justify-content-between align-items-center">
                    <span><i class="bi bi-building"></i> ${dept}</span>
                    <button class="btn btn-sm btn-success px-3" onclick="App.sendWhatsAppMessage('DepOne', '${dept.replace(/'/g, "\\'")}')" style="box-shadow: 0 4px 6px rgba(25, 135, 84, 0.2); border-radius: 8px;">
                        <i class="bi bi-whatsapp"></i> إرسال واتساب للقسم
                    </button>
                </div>`;
                byDept[dept].sort((a, b) => a.instructor.localeCompare(b.instructor, 'ar')).forEach(g => {
                    totalFiltered += g.items.length;
                    html += `<div class="instructor-header"><i class="bi bi-person-badge"></i> المدرب: ${g.instructor} (${g.items.length} متدرب)</div>`;
                    html += `<table class="data-table"><thead><tr>
                        <th>م</th><th>رقم المتدرب</th><th>اسم المتدرب</th><th>رقم الجوال</th><th>التخصص</th>
                        <th>الحرمان</th>
                        <th>المقرر</th><th>اسم المقرر</th><th>الرقم المرجعي</th><th>نوع الجدولة</th><th>المدرب</th>
                    </tr></thead><tbody>`;
                    g.items.forEach((item, i) => {
                        const _totalC = item.trainee.courses.size;
                        let _depC = 0;
                        item.trainee.courses.forEach(c => { if (c.deprived) _depC++; });
                        html += `<tr><td>${i + 1}</td><td>${item.trainee.id}</td><td>${item.trainee.name}</td><td>${item.trainee.phone}</td><td>${item.trainee.spec}</td>
                            <td class="dep-ratio-cell"><span class="dep-ratio-num">${_depC}</span> <span class="dep-ratio-sep">/</span> <span class="dep-ratio-den">${_totalC}</span></td>
                            <td>${item.course.code}</td><td>${item.course.name}</td><td>${item.course.ref}</td><td>${item.course.schedule}</td><td>${item.course.instructor}</td></tr>`;
                    });
                    html += '</tbody></table>';
                });
                html += '</div>';
            });
        }
        c.innerHTML = html;

        const valSpan = document.getElementById('valCountOne');
        if (valSpan) {
            valSpan.textContent = totalFiltered;
            const badge = document.getElementById('badgeCountOne');
            if (badge) {
                badge.classList.remove('pop');
                void badge.offsetWidth; // trigger reflow
                badge.classList.add('pop');
            }
        }
    }

    // ===== عرض المحرومين إلا مقررين =====
    function renderDepTwo() {
        const filter = document.getElementById('filterDepTwo').value;
        const fiftyBtn = document.getElementById('btnFiftyPercentTwo');
        const applyFiftyPct = fiftyBtn && fiftyBtn.classList.contains('active');
        const repeatedBtn = document.getElementById('btnRepeatedOnly');
        const showRepeatedOnly = repeatedBtn && repeatedBtn.classList.contains('active');
        const c = document.getElementById('depTwoContainer');

        // كل متدرب يظهر مرتين - مرة لكل مدرب
        const grouped = {};
        state.deprivedExceptTwo.forEach(({ trainee, remainingCourses }) => {
            if (applyFiftyPct) {
                const totalC = trainee.courses.size;
                let depC = 0;
                trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                if (depC / totalC < 0.5) return;
            }
            remainingCourses.forEach(course => {
                const courseDept = getDeptForCourse(course);
                if (filter && courseDept !== filter) return;
                const instructor = course.instructor || 'غير محدد';
                const key = `${courseDept}|||${instructor}`;
                if (!grouped[key]) grouped[key] = { dept: courseDept, instructor, items: [] };
                grouped[key].items.push({ trainee, course });
            });
        });

        let totalFiltered = 0;
        let html = '';
        if (Object.keys(grouped).length === 0) {
            html = '<div class="alert alert-info text-center"><i class="bi bi-info-circle"></i> لا توجد بيانات</div>';
        } else {
            const byDept = {};
            Object.values(grouped).forEach(g => {
                if (!byDept[g.dept]) byDept[g.dept] = [];
                byDept[g.dept].push(g);
            });
            let finalHtml = '';
            Object.keys(byDept).sort((a, b) => a.localeCompare(b, 'ar')).forEach(dept => {
                let deptHtml = `<div class="data-table-wrapper"><div class="dept-header d-flex justify-content-between align-items-center">
                    <span><i class="bi bi-building"></i> ${dept}</span>
                    <button class="btn btn-sm btn-success px-3" onclick="App.sendWhatsAppMessage('DepTwo', '${dept.replace(/'/g, "\\'")}')" style="box-shadow: 0 4px 6px rgba(25, 135, 84, 0.2); border-radius: 8px;">
                        <i class="bi bi-whatsapp"></i> إرسال واتساب للقسم
                    </button>
                </div>`;
                let hasValidContent = false;
                byDept[dept].sort((a, b) => a.instructor.localeCompare(b.instructor, 'ar')).forEach(g => {
                    const traineeCounts = {};
                    g.items.forEach(item => {
                        traineeCounts[item.trainee.id] = (traineeCounts[item.trainee.id] || 0) + 1;
                    });
                    
                    let finalItems = g.items;
                    if (showRepeatedOnly) {
                        finalItems = g.items.filter(item => traineeCounts[item.trainee.id] > 1);
                    }
                    if (finalItems.length === 0) return;

                    hasValidContent = true;
                    totalFiltered += new Set(finalItems.map(item => item.trainee.id)).size;
                    
                    deptHtml += `<div class="instructor-header"><i class="bi bi-person-badge"></i> المدرب: ${g.instructor} (${finalItems.length} سجل)</div>`;
                    deptHtml += `<table class="data-table"><thead><tr>
                        <th>م</th><th>رقم المتدرب</th><th>اسم المتدرب</th><th>رقم الجوال</th><th>التخصص</th>
                        <th>الحرمان</th>
                        <th>المقرر</th><th>اسم المقرر</th><th>الرقم المرجعي</th><th>نوع الجدولة</th><th>المدرب</th>
                    </tr></thead><tbody>`;
                    finalItems.forEach((item, i) => {
                        const _totalC = item.trainee.courses.size;
                        let _depC = 0;
                        item.trainee.courses.forEach(c => { if (c.deprived) _depC++; });
                        const trClass = traineeCounts[item.trainee.id] > 1 ? ' class="highlight-repeated"' : '';
                        deptHtml += `<tr${trClass}><td>${i + 1}</td><td>${item.trainee.id}</td><td>${item.trainee.name}</td><td>${item.trainee.phone}</td><td>${item.trainee.spec}</td>
                            <td class="dep-ratio-cell"><span class="dep-ratio-num">${_depC}</span> <span class="dep-ratio-sep">/</span> <span class="dep-ratio-den">${_totalC}</span></td>
                            <td>${item.course.code}</td><td>${item.course.name}</td><td>${item.course.ref}</td><td>${item.course.schedule}</td><td>${item.course.instructor}</td></tr>`;
                    });
                    deptHtml += '</tbody></table>';
                });
                deptHtml += '</div>';
                if (hasValidContent) {
                    finalHtml += deptHtml;
                }
            });
            html = finalHtml || '<div class="alert alert-info text-center"><i class="bi bi-info-circle"></i> لا توجد بيانات للمشاهدة</div>';
        }
        c.innerHTML = html;

        const valSpan = document.getElementById('valCountTwo');
        if (valSpan) {
            valSpan.textContent = totalFiltered;
            const badge = document.getElementById('badgeCountTwo');
            if (badge) {
                badge.classList.remove('pop');
                void badge.offsetWidth;
                badge.classList.add('pop');
            }
        }
    }

    // ===== مساعد: تحديد قسم المقرر =====
    function getDeptForCourse(course) {
        if (course.dept === GENERAL_DEPT) return GENERAL_DEPT;
        
        // البحث عن القسم من خلال المدرب والتزام تعديلات التخصصات (mapping)
        const inst = state.instructors[course.instructor];
        if (inst) {
            if (inst.spec && state.deptSpecMapping[inst.spec]) {
                return state.deptSpecMapping[inst.spec];
            }
            return inst.dept;
        }
        return course.dept || 'غير محدد';
    }

    // ===== مساعد: التاريخ الهجري =====
    function getHijriDate(dateObj) {
        try {
            const target = dateObj || new Date();
            const parts = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura', {
                day: '2-digit', month: '2-digit', year: 'numeric'
            }).formatToParts(target);
            const d = parts.find(p => p.type === 'day').value;
            const m = parts.find(p => p.type === 'month').value;
            const y = parts.find(p => p.type === 'year').value;
            return `${d} / ${m} / ${y}`;
        } catch { return ''; }
    }

    // ===== بناء ترويسة الطباعة =====
    function buildPrintHeader(reportTitle, deptName, specNames) {
        const reportHijri = state.reportDate ? getHijriDate(new Date(state.reportDate)) : getHijriDate();
        const printHijri = getHijriDate();

        return `<div class="print-header">
            <div class="print-header-col">
                <div><strong>المملكة العربية السعودية</strong></div>
                <div>المؤسسة العامة للتدريب التقني والمهني</div>
                <div><strong>${state.collegeName}</strong></div>
            </div>
            <div class="print-header-col">
                <img src="logo.png" alt="الشعار">
            </div>
            <div class="print-header-col">
                <div><strong>${state.semester}</strong></div>
                <div style="margin-top:3px;"><strong>تاريخ التقرير:</strong> ${reportHijri} هـ</div>
                <div style="font-size:8px;color:#888;margin-top:2px;">تاريخ الطباعة: ${printHijri} هـ</div>
            </div>
        </div>
        ${reportTitle ? `<div class="print-report-title-full">${reportTitle}</div>` : ''}
        ${deptName ? `<div class="print-dept-info">القسم: ${deptName}${specNames ? ' | التخصص: ' + specNames : ''}</div>` : ''}`;
    }

    // ===== صفحة غلاف القسم =====
    function buildCoverPage(reportTitle, deptName) {
        return `<div class="cover-page print-page">
            ${buildPrintHeader('', '', '')}
            <div class="cover-dept"><i class="bi bi-building"></i> ${deptName}</div>
            <div style="font-size:24px;font-weight:800;color:var(--primary);margin-bottom:15px;">${reportTitle}</div>
            <div style="font-size:18px;color:var(--outline);">${state.semester}</div>
        </div>`;
    }

    // ===== مساعد: تعيين عنوان الطباعة =====
    const _originalTitle = document.title;
    function setPrintTitle(reportName, deptName) {
        const deptPart = deptName ? ` - ${deptName}` : ' - جميع الأقسام';
        document.title = `${reportName}${deptPart}`;
    }
    function restorePrintTitle() {
        document.title = _originalTitle;
    }

    // ===== طباعة الملخص =====
    function printSummary() {
        const pa = document.getElementById('printArea');

        // حساب إجماليات الكلية
        const collegeTotals = state.stats.reduce((acc, s) => {
            acc.total += s.total || 0;
            acc.sw += s.semesterWithdrawal || 0;
            acc.tw += s.twoWeekAbsence || 0;
            acc.en += s.enrolled || 0;
            acc.da += s.deprivedAll || 0;
            acc.d1 += s.deprivedExceptOne || 0;
            acc.d2 += s.deprivedExceptTwo || 0;
            return acc;
        }, { total: 0, sw: 0, tw: 0, en: 0, da: 0, d1: 0, d2: 0 });

        // دالة مساعدة للنسبة في الطباعة
        const printPct = (val, total) => {
            if (!val || !total || percentMode === 'none') return '';
            const pct = ((val / total) * 100);
            const pctStr = pct < 1 && pct > 0 ? pct.toFixed(1) : Math.round(pct);
            return ` <span style="font-size:7.5px;color:#666;font-weight:400">(${pctStr}%)</span>`;
        };

        const modeLabel = percentMode === 'spec' ? ' (نسبة تخصصية)' : percentMode === 'college' ? ' (نسبة كلية)' : '';

        let html = `<div class="print-page">
            ${buildPrintHeader('الملخص الإحصائي للحرمان' + modeLabel, '', '')}
            <table class="print-table"><thead><tr>
                <th>القسم</th><th>التخصص</th><th>العدد الإجمالي</th>
                <th>انسحاب فصلي</th><th>منقطع أسبوعين</th><th>مطوي قيده</th>
                <th>محروم بالكل</th><th>محروم إلا مقرر</th><th>محروم إلا مقررين</th>
            </tr></thead><tbody>`;
        let currentDept = null;
        let deptRowCount = 0;
        const deptCounts = {};
        state.stats.forEach(s => {
            deptCounts[s.dept] = (deptCounts[s.dept] || 0) + 1;
        });

        state.stats.forEach(s => {
            const isFirstOfDept = s.dept !== currentDept;
            if (isFirstOfDept) {
                currentDept = s.dept;
                deptRowCount = 0;
            }
            deptRowCount++;
            const isLastOfDept = deptRowCount === deptCounts[s.dept];
            const trClass = isLastOfDept ? ' class="dept-last-row"' : '';

            const specTotal = s.total;
            const printCellVal = (val, collegeCategoryTotal) => {
                if (!val) return '-';
                if (percentMode === 'spec') {
                    return `${val}${printPct(val, specTotal)}`;
                } else if (percentMode === 'college') {
                    return `${val}${printPct(val, collegeCategoryTotal)}`;
                }
                return val;
            };

            html += `<tr${trClass}>`;
            if (isFirstOfDept) {
                html += `<td rowspan="${deptCounts[s.dept]}" style="vertical-align: middle; font-weight: 800; border-bottom: 2px solid var(--outline); background: var(--surface-container);">${s.dept}</td>`;
            }

            html += `<td>${s.spec}</td><td><strong>${s.total}</strong>${percentMode === 'college' ? printPct(s.total, collegeTotals.total) : ''}</td>
                <td>${printCellVal(s.semesterWithdrawal, collegeTotals.sw)}</td><td>${printCellVal(s.twoWeekAbsence, collegeTotals.tw)}</td><td>${printCellVal(s.enrolled, collegeTotals.en)}</td>
                <td>${printCellVal(s.deprivedAll, collegeTotals.da)}</td><td>${printCellVal(s.deprivedExceptOne, collegeTotals.d1)}</td><td>${printCellVal(s.deprivedExceptTwo, collegeTotals.d2)}</td></tr>`;
        });
        html += '</tbody>';

        // حساب الإجماليات للطباعة
        const totals = collegeTotals;

        html += `<tfoot>
            <tr style="background:#eee;font-weight:800;text-align:center">
                <td colspan="2">الإجمالي</td>
                <td>${totals.total}</td>
                <td>${totals.sw || '-'}</td>
                <td>${totals.tw || '-'}</td>
                <td>${totals.en || '-'}</td>
                <td>${totals.da || '-'}</td>
                <td>${totals.d1 || '-'}</td>
                <td>${totals.d2 || '-'}</td>
            </tr>
        </tfoot></table>`;

        // === جدول توزيع المحرومين (إلا مقرر) حسب قسم المقرر المتبقي — طباعة ===
        if (state.deprivedExceptOne.length > 0) {
            const printCourseDeptMap = {};
            state.deprivedExceptOne.forEach(({ trainee, remainingCourse }) => {
                const courseDept = getDeptForCourse(remainingCourse);
                if (!printCourseDeptMap[courseDept]) printCourseDeptMap[courseDept] = 0;
                printCourseDeptMap[courseDept]++;
            });

            const printSortedDepts = Object.entries(printCourseDeptMap).sort((a, b) => b[1] - a[1]);

            html += `</div><div class="print-page">
                ${buildPrintHeader('توزيع المحرومين (إلا مقرر) حسب قسم المقرر المتبقي', '', '')}
                <p style="font-size:8px;color:#666;text-align:center;margin-bottom:4mm;">يُظهر هذا الجدول أي قسم ينتمي إليه المقرر الذي لم يُحرم فيه المتدرب — للكشف عن التساهل المحتمل في التحضير</p>
                <table class="print-table">
                    <thead><tr>
                        <th>م</th><th>قسم المقرر المتبقي</th><th>عدد المتدربين</th><th>النسبة</th>
                    </tr></thead><tbody>`;

            printSortedDepts.forEach(([dept, count], i) => {
                const pct = ((count / state.deprivedExceptOne.length) * 100);
                const pctStr = pct < 1 && pct > 0 ? pct.toFixed(1) : Math.round(pct);
                html += `<tr><td>${i + 1}</td><td style="font-weight:700;">${dept}</td><td><strong>${count}</strong></td><td>${pctStr}%</td></tr>`;
            });

            html += `</tbody>
                <tfoot><tr style="background:#eee;font-weight:800;text-align:center">
                    <td></td><td>الإجمالي</td><td>${state.deprivedExceptOne.length}</td><td>100%</td>
                </tr></tfoot></table></div>`;
        } else {
            html += `</div>`;
        }

        // إضافة المخطط البياني كصورة في الطباعة
        const chartCanvas = document.getElementById('deprivationChart');
        if (chartCanvas && deprivationChartInstance) {
            try {
                const chartImg = chartCanvas.toDataURL('image/png', 1.0);
                html += `<div class="print-page">
                    ${buildPrintHeader('المخطط البياني لنسب الحرمان', '', '')}
                    <div style="display:flex;justify-content:center;align-items:flex-start;padding-top:5mm;">
                        <img src="${chartImg}" style="max-width:100%;max-height:150mm;object-fit:contain;" alt="مخطط نسب المحرومين">
                    </div>
                </div>`;
            } catch (e) {
                console.warn('تعذر تصدير المخطط للطباعة:', e);
            }
        }

        pa.innerHTML = html;
        setPrintTitle('الملخص الإحصائي للحرمان', '');
        // حقن أسلوب مؤقت لتحويل صفحة الملخص إلى أفقي
        const landscapeStyle = document.createElement('style');
        landscapeStyle.id = 'summary-landscape-override';
        landscapeStyle.textContent = '@media print { @page { size: A4 landscape; } }';
        document.head.appendChild(landscapeStyle);
        setTimeout(() => {
            window.print();
            restorePrintTitle();
            // إزالة الأسلوب المؤقت بعد الطباعة
            landscapeStyle.remove();
        }, 300);
    }

    // ===== طباعة المحرومين بجميع المقررات =====
    function printDepAll() {
        const pa = document.getElementById('printArea');
        const filter = document.getElementById('filterDepAll').value;
        const grouped = {};
        state.deprivedAll.forEach(t => {
            const dept = state.deptSpecMapping[t.spec] || t.dept;
            if (filter && dept !== filter) return;
            const spec = t.spec || 'غير محدد';
            if (!grouped[dept]) grouped[dept] = {};
            if (!grouped[dept][spec]) grouped[dept][spec] = [];
            grouped[dept][spec].push(t);
        });

        let html = '';
        Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar')).forEach(dept => {
            html += buildCoverPage('(مستمر) المحرومون بجميع المقررات', dept);
            Object.keys(grouped[dept]).sort((a, b) => a.localeCompare(b, 'ar')).forEach(spec => {
                const trainees = grouped[dept][spec];
                html += `<div class="print-page">
                    ${buildPrintHeader('(مستمر) المحرومون بجميع المقررات', dept, spec)}
                    <table class="print-table"><thead><tr>
                        <th>م</th><th>رقم المتدرب</th><th>اسم المتدرب</th><th>رقم الجوال</th><th>التخصص</th><th>القسم</th><th>الحرمان</th>
                    </tr></thead><tbody>`;
                trainees.forEach((t, i) => {
                    const _totalC = t.courses.size;
                    let _depC = 0;
                    t.courses.forEach(c => { if (c.deprived) _depC++; });
                    html += `<tr><td>${i + 1}</td><td>${t.id}</td><td>${t.name}</td><td>${t.phone}</td><td>${t.spec}</td><td>${dept}</td>
                        <td class="dep-ratio-cell"><span class="dep-ratio-num">${_depC}</span> <span class="dep-ratio-sep">/</span> <span class="dep-ratio-den">${_totalC}</span></td></tr>`;
                });
                html += '</tbody></table></div>';
            });
        });
        pa.innerHTML = html;
        const deptNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar'));
        const deptLabel = deptNames.length > 2 ? 'جميع الأقسام' : deptNames.join(' و ');
        setPrintTitle('(مستمر) محرومون بجميع المقررات', deptLabel);
        setTimeout(() => { window.print(); restorePrintTitle(); }, 300);
    }

    // ===== طباعة المحرومين إلا مقرر =====
    function printDepOne() {
        const pa = document.getElementById('printArea');
        const filter = document.getElementById('filterDepOne').value;
        const fiftyBtn = document.getElementById('btnFiftyPercentOne');
        const applyFiftyPct = fiftyBtn && fiftyBtn.classList.contains('active');
        
        const grouped = {};
        state.deprivedExceptOne.forEach(({ trainee, remainingCourse }) => {
            if (applyFiftyPct) {
                const totalC = trainee.courses.size;
                let depC = 0;
                trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                if (depC / totalC < 0.5) return;
            }
            const courseDept = getDeptForCourse(remainingCourse);
            if (filter && courseDept !== filter) return;
            const instructor = remainingCourse.instructor || 'غير محدد';
            if (!grouped[courseDept]) grouped[courseDept] = {};
            if (!grouped[courseDept][instructor]) grouped[courseDept][instructor] = [];
            grouped[courseDept][instructor].push({ trainee, course: remainingCourse });
        });

        let html = '';
        Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar')).forEach(dept => {
            html += buildCoverPage('المحرومون بجميع المقررات إلا مقرر واحد', dept);
            Object.keys(grouped[dept]).sort((a, b) => a.localeCompare(b, 'ar')).forEach(instructor => {
                const items = grouped[dept][instructor];
                html += `<div class="print-page">
                    ${buildPrintHeader('المحرومون بجميع المقررات إلا مقرر واحد', dept, '')}
                    <div class="print-dept-info">المدرب: ${instructor}</div>
                    <table class="print-table"><thead><tr>
                        <th>م</th><th>رقم المتدرب</th><th>اسم المتدرب</th><th>رقم الجوال</th><th>التخصص</th>
                        <th>المقرر</th><th>اسم المقرر</th><th>الرقم المرجعي</th><th>نوع الجدولة</th>
                    </tr></thead><tbody>`;
                items.forEach((item, i) => {
                    html += `<tr><td>${i + 1}</td><td>${item.trainee.id}</td><td>${item.trainee.name}</td><td>${item.trainee.phone}</td><td>${item.trainee.spec}</td>
                        <td>${item.course.code}</td><td>${item.course.name}</td><td>${item.course.ref}</td><td>${item.course.schedule}</td></tr>`;
                });
                html += '</tbody></table></div>';
            });
        });
        pa.innerHTML = html;
        const deptNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar'));
        const deptLabel = deptNames.length > 2 ? 'جميع الأقسام' : deptNames.join(' و ');
        setPrintTitle('محرومون إلا مقرر واحد', deptLabel);
        setTimeout(() => { window.print(); restorePrintTitle(); }, 300);
    }

    // ===== طباعة المحرومين إلا مقررين =====
    function printDepTwo() {
        const pa = document.getElementById('printArea');
        const filter = document.getElementById('filterDepTwo').value;
        const fiftyBtn = document.getElementById('btnFiftyPercentTwo');
        const applyFiftyPct = fiftyBtn && fiftyBtn.classList.contains('active');
        const repeatedBtn = document.getElementById('btnRepeatedOnly');
        const showRepeatedOnly = repeatedBtn && repeatedBtn.classList.contains('active');

        const grouped = {};
        state.deprivedExceptTwo.forEach(({ trainee, remainingCourses }) => {
            if (applyFiftyPct) {
                const totalC = trainee.courses.size;
                let depC = 0;
                trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                if (depC / totalC < 0.5) return;
            }
            remainingCourses.forEach(course => {
                const courseDept = getDeptForCourse(course);
                if (filter && courseDept !== filter) return;
                const instructor = course.instructor || 'غير محدد';
                if (!grouped[courseDept]) grouped[courseDept] = {};
                if (!grouped[courseDept][instructor]) grouped[courseDept][instructor] = [];
                grouped[courseDept][instructor].push({ trainee, course });
            });
        });

        let html = '';
        let printHtml = '';
        Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar')).forEach(dept => {
            let deptHtml = buildCoverPage('المحرومون بجميع المقررات إلا مقررين', dept);
            let hasValidContent = false;
            Object.keys(grouped[dept]).sort((a, b) => a.localeCompare(b, 'ar')).forEach(instructor => {
                const items = grouped[dept][instructor];
                const traineeCounts = {};
                items.forEach(item => {
                    traineeCounts[item.trainee.id] = (traineeCounts[item.trainee.id] || 0) + 1;
                });
                
                let finalItems = items;
                if (showRepeatedOnly) {
                    finalItems = items.filter(item => traineeCounts[item.trainee.id] > 1);
                }
                if (finalItems.length === 0) return;

                hasValidContent = true;
                deptHtml += `<div class="print-page">
                    ${buildPrintHeader('المحرومون بجميع المقررات إلا مقررين', dept, '')}
                    <div class="print-dept-info">المدرب: ${instructor}</div>
                    <table class="print-table"><thead><tr>
                        <th>م</th><th>رقم المتدرب</th><th>اسم المتدرب</th><th>رقم الجوال</th><th>التخصص</th>
                        <th>المقرر</th><th>اسم المقرر</th><th>الرقم المرجعي</th><th>نوع الجدولة</th>
                    </tr></thead><tbody>`;
                finalItems.forEach((item, i) => {
                    const trClass = traineeCounts[item.trainee.id] > 1 ? ' class="highlight-repeated"' : '';
                    deptHtml += `<tr${trClass}><td>${i + 1}</td><td>${item.trainee.id}</td><td>${item.trainee.name}</td><td>${item.trainee.phone}</td><td>${item.trainee.spec}</td>
                        <td>${item.course.code}</td><td>${item.course.name}</td><td>${item.course.ref}</td><td>${item.course.schedule}</td></tr>`;
                });
                deptHtml += '</tbody></table></div>';
            });
            if (hasValidContent) {
                printHtml += deptHtml;
            }
        });
        pa.innerHTML = printHtml || '<div style="text-align: center; padding: 50px;">لا توجد بيانات متوافقة مع الفلاتر المحددة للطباعة</div>';
        const deptNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar'));
        const deptLabel = deptNames.length > 2 ? 'جميع الأقسام' : deptNames.join(' و ');
        setPrintTitle('محرومون إلا مقررين', deptLabel);
        setTimeout(() => { window.print(); restorePrintTitle(); }, 300);
    }

    // ===== شاشة التنظيم (Drag & Drop Board) =====
    let draggedSpec = null;
    let draggedFromDept = null;

    function renderMappingBoard() {
        const board = document.getElementById('mappingBoard');
        const allDepts = Object.keys(state.departments)
            .filter(d => d !== GENERAL_DEPT)
            .sort((a, b) => a.localeCompare(b, 'ar'));

        // تخصصات غير مرتبطة
        const assignedSpecs = new Set();
        Object.values(state.departments).forEach(specSet => {
            (specSet instanceof Set ? specSet : []).forEach(s => assignedSpecs.add(s));
        });
        const unassigned = [...state.allKnownSpecs].filter(s => !assignedSpecs.has(s)).sort((a, b) => a.localeCompare(b, 'ar'));

        let html = '';

        // أعمدة الأقسام
        allDepts.forEach(dept => {
            const specs = state.departments[dept] ? Array.from(state.departments[dept]).sort((a, b) => a.localeCompare(b, 'ar')) : [];
            const isAdded = state.addedDepts.has(dept);
            html += `<div class="dept-column" data-dept="${dept}">`;
            let safeId = "phoneInput_" + dept.replace(/\W/g, '_');
            html += `<div class="dept-column-header d-flex flex-column gap-2">
                <div class="d-flex justify-content-between w-100 align-items-start" style="min-height: 48px;">
                    <span style="font-weight: 800; font-size: 1rem; line-height: 1.5; padding-top: 2px;">
                        <i class="bi bi-building"></i> ${dept}
                    </span>
                    <div style="white-space: nowrap;">
                        ${isAdded ? `<button class="dept-delete" data-dept="${dept}" title="حذف"><i class="bi bi-trash3"></i></button>` : ''}
                    </div>
                </div>
                <div class="input-group input-group-sm w-100 mt-1">
                    <input type="text" id="${safeId}" class="form-control" placeholder="05XXXXXXXX" value="${state.deptPhones[dept] || ''}" style="font-size: 0.85rem; text-align: center;">
                    <button class="btn btn-outline-success" onclick="App.saveDeptPhone('${dept.replace(/'/g, "\\'")}', document.getElementById('${safeId}').value, this, '${safeId}')" title="حفظ الرقم" style="z-index: 0;">
                        <i class="bi bi-floppy"></i>
                    </button>
                </div>
            </div>`;
            html += `<div class="dept-column-body" data-dept="${dept}">`;
            specs.forEach(spec => {
                html += `<div class="spec-card" draggable="true" data-spec="${spec}" data-dept="${dept}">${spec}</div>`;
            });
            if (specs.length === 0) {
                html += '<div style="color:var(--outline);font-size:0.75rem;text-align:center;padding:8px">اسحب تخصصاً هنا</div>';
            }
            html += '</div></div>';
        });

        // عمود التخصصات غير المرتبطة
        if (unassigned.length > 0) {
            html += `<div class="dept-column" data-dept="__unassigned__" style="border: 2px dashed var(--secondary)">`;
            html += `<div class="dept-column-header" style="background:var(--secondary-container);color:var(--on-secondary-container)">
                <span><i class="bi bi-link-break"></i> غير مرتبطة</span>
                <span class="dept-count">${unassigned.length}</span>
            </div>`;
            html += `<div class="dept-column-body" data-dept="__unassigned__">`;
            unassigned.forEach(spec => {
                html += `<div class="spec-card" draggable="true" data-spec="${spec}" data-dept="__unassigned__">${spec}</div>`;
            });
            html += '</div></div>';
        }

        // صندوق إضافة قسم
        html += `<div class="add-dept-column" id="addDeptBox" onclick="App.showAddDeptInput()">
            <i class="bi bi-plus-lg"></i>
            <span>إضافة قسم</span>
        </div>`;

        board.innerHTML = html;
        setupDragAndDrop();
        setupDeleteBtns();
    }

    function setupDragAndDrop() {
        // بطاقات التخصصات
        document.querySelectorAll('.spec-card[draggable]').forEach(card => {
            card.addEventListener('dragstart', e => {
                draggedSpec = card.dataset.spec;
                draggedFromDept = card.dataset.dept;
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggedSpec);
            });
            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                document.querySelectorAll('.dept-column.drag-over').forEach(c => c.classList.remove('drag-over'));
                draggedSpec = null;
                draggedFromDept = null;
            });
        });

        // مناطق الإسقاط (أجسام الأعمدة)
        document.querySelectorAll('.dept-column-body').forEach(body => {
            body.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                body.closest('.dept-column').classList.add('drag-over');
            });
            body.addEventListener('dragleave', e => {
                if (!body.contains(e.relatedTarget)) {
                    body.closest('.dept-column').classList.remove('drag-over');
                }
            });
            body.addEventListener('drop', e => {
                e.preventDefault();
                body.closest('.dept-column').classList.remove('drag-over');
                const targetDept = body.dataset.dept;
                if (!draggedSpec || targetDept === draggedFromDept) return;
                moveSpec(draggedSpec, draggedFromDept, targetDept);
            });
        });
    }

    function moveSpec(spec, fromDept, toDept) {
        // إزالة من القسم القديم
        if (fromDept !== '__unassigned__' && state.departments[fromDept]) {
            state.departments[fromDept].delete(spec);
        }
        // إضافة للقسم الجديد
        if (toDept === '__unassigned__') {
            delete state.deptSpecMapping[spec];
        } else {
            state.deptSpecMapping[spec] = toDept;
            if (!state.departments[toDept]) state.departments[toDept] = new Set();
            state.departments[toDept].add(spec);
        }
        saveToStorage();
        renderMappingBoard();
    }

    function setupDeleteBtns() {
        document.querySelectorAll('.dept-delete').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const dept = btn.dataset.dept;
                if (!confirm(`حذف القسم "${dept}"؟ ستُنقل تخصصاته لغير المرتبطة.`)) return;
                if (state.departments[dept]) {
                    state.departments[dept].forEach(s => delete state.deptSpecMapping[s]);
                    delete state.departments[dept];
                }
                state.addedDepts.delete(dept);
                saveToStorage();
                renderMappingBoard();
            });
        });
    }

    function showAddDeptInput() {
        const box = document.getElementById('addDeptBox');
        box.innerHTML = `<div class="add-dept-input-group">
            <input type="text" id="newDeptInput" placeholder="اسم القسم" autofocus>
            <button onclick="App.addDeptFromBoard()"><i class="bi bi-check-lg"></i></button>
        </div>`;
        box.onclick = null;
        setTimeout(() => document.getElementById('newDeptInput')?.focus(), 50);
        document.getElementById('newDeptInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') App.addDeptFromBoard();
            if (e.key === 'Escape') renderMappingBoard();
        });
    }

    function addDeptFromBoard() {
        const input = document.getElementById('newDeptInput');
        const name = input?.value.trim();
        if (!name) return;
        if (state.departments[name]) return alert('القسم موجود بالفعل.');
        state.departments[name] = new Set();
        state.addedDepts.add(name);
        saveToStorage();
        renderMappingBoard();
    }

    // ===== إجراءات الإعدادات =====
    let _collegeDebounce = null;

    function setupCollegeAutoSave() {
        const input = document.getElementById('settingsCollege');
        if (!input) return;
        input.addEventListener('input', () => {
            clearTimeout(_collegeDebounce);
            _collegeDebounce = setTimeout(() => {
                state.collegeName = input.value.trim();
                document.getElementById('topCollege').textContent = state.collegeName;
                saveToStorage();
                // إظهار مؤشر الحفظ
                const status = document.getElementById('collegeSaveStatus');
                if (status) {
                    status.innerHTML = '<i class="bi bi-check-circle-fill"></i> تم الحفظ';
                    status.classList.add('show');
                    setTimeout(() => status.classList.remove('show'), 2000);
                }
            }, 500);
        });
    }

    function saveCollegeName() {
        state.collegeName = document.getElementById('settingsCollege').value.trim();
        document.getElementById('topCollege').textContent = state.collegeName;
        saveToStorage();
    }

    function unlinkSpec(spec, dept) {
        if (state.departments[dept]) state.departments[dept].delete(spec);
        delete state.deptSpecMapping[spec];
        // لا نحذف من allKnownSpecs — يبقى التخصص معروفاً دائماً
        saveToStorage();
        renderMappingBoard();
    }

    function recalcAndRender() {
        calculateDeprivation();
        calculateStats();
        renderSummary();
        renderDepAll();
        renderDepOne();
        renderDepTwo();
        populateFilters();
        saveToStorage();
    }

    // ===== IndexedDB + localStorage للتخزين =====
    const SETTINGS_KEY = 'sf01_deprivation_settings';
    const IDB_NAME = 'sf01_deprivation_db';
    const IDB_VERSION = 1;
    const IDB_STORE = 'csvData';

    // فتح قاعدة بيانات IndexedDB
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(IDB_NAME, IDB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // حفظ بيانات في IndexedDB
    function idbPut(key, value) {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                const req = store.put(value, key);
                req.onsuccess = () => resolve();
                req.onerror = (e) => reject(e.target.error);
                tx.oncomplete = () => db.close();
            });
        });
    }

    // قراءة بيانات من IndexedDB
    function idbGet(key) {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const store = tx.objectStore(IDB_STORE);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = (e) => reject(e.target.error);
                tx.oncomplete = () => db.close();
            });
        });
    }

    // حذف بيانات من IndexedDB
    function idbDelete(key) {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                const req = store.delete(key);
                req.onsuccess = () => resolve();
                req.onerror = (e) => reject(e.target.error);
                tx.oncomplete = () => db.close();
            });
        });
    }

    // حذف قاعدة البيانات بالكامل
    function idbClear() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(IDB_NAME);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    function saveToStorage() {
        // 1. حفظ الإعدادات في localStorage (حجمها صغير جداً)
        try {
            const settings = {
                collegeName: state.collegeName,
                deptSpecMapping: state.deptSpecMapping,
                deptPhones: state.deptPhones,
                departments: {},
                addedDepts: Array.from(state.addedDepts),
                allKnownSpecs: Array.from(state.allKnownSpecs),
                reportDate: state.reportDate
            };
            Object.keys(state.departments).forEach(d => {
                settings.departments[d] = Array.from(state.departments[d]);
            });
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('فشل حفظ الإعدادات:', e);
        }

        // 2. حفظ البيانات في IndexedDB (تدعم ملفات كبيرة جداً 50MB+)
        const data = {
            semester: state.semester,
            collegeName: state.collegeName,
            rawRows: state.rawRows
        };
        idbPut('mainData', data).catch(e => {
            console.warn('فشل حفظ البيانات في IndexedDB:', e);
        });
    }

    async function loadFromStorage() {
        try {
            // 1. استعادة الإعدادات من localStorage
            const settingsRaw = localStorage.getItem(SETTINGS_KEY);
            let savedSettings = null;
            if (settingsRaw) {
                savedSettings = JSON.parse(settingsRaw);
            }

            // 2. استعادة البيانات من IndexedDB
            let data = null;
            try {
                data = await idbGet('mainData');
            } catch (e) {
                console.warn('فشل قراءة IndexedDB:', e);
            }

            // 3. محاولة قراءة من localStorage القديم (للتوافق مع البيانات السابقة)
            if (!data) {
                try {
                    const oldRaw = localStorage.getItem(STORAGE_KEY);
                    if (oldRaw) {
                        data = JSON.parse(oldRaw);
                        // ترحيل البيانات القديمة إلى IndexedDB
                        if (data && data.rawRows) {
                            await idbPut('mainData', data);
                            localStorage.removeItem(STORAGE_KEY); // حذف من localStorage بعد الترحيل
                            console.info('تم ترحيل البيانات من localStorage إلى IndexedDB.');
                        }
                    }
                } catch (_) { /* ignore */ }
            }

            if (!data && !savedSettings) return;

            if (data && data.rawRows && data.rawRows.length > 0) {
                document.getElementById('savedDataNotice').classList.remove('d-none');
                // إعادة المعالجة
                processData(data.rawRows);

                // استعادة اسم الكلية من الإعدادات أو البيانات
                if (savedSettings && savedSettings.collegeName) {
                    state.collegeName = savedSettings.collegeName;
                } else if (data.collegeName) {
                    state.collegeName = data.collegeName;
                }

                // استعادة الإعدادات المحفوظة
                if (savedSettings) {
                    applySettings(savedSettings);
                    // استعادة تاريخ التقرير
                    if (savedSettings.reportDate) {
                        state.reportDate = savedSettings.reportDate;
                    }
                }

                calculateDeprivation();
                calculateStats();
                showApp();
            } else if (savedSettings) {
                // البيانات غير متوفرة لكن الإعدادات موجودة
                console.info('الإعدادات موجودة لكن البيانات تحتاج رفع ملف جديد.');
            }
        } catch (e) {
            console.warn('فشل استرداد البيانات:', e);
        }
    }

    function applySettings(savedSettings) {
        // استعادة الأقسام المضافة
        if (savedSettings.addedDepts) {
            savedSettings.addedDepts.forEach(d => {
                state.addedDepts.add(d);
                if (!state.departments[d]) state.departments[d] = new Set();
            });
        }
        // استعادة كل التخصصات المعروفة
        if (savedSettings.allKnownSpecs) {
            savedSettings.allKnownSpecs.forEach(s => state.allKnownSpecs.add(s));
        }
        if (savedSettings.deptSpecMapping) {
            state.deptSpecMapping = savedSettings.deptSpecMapping;
            // إعادة بناء departments من mapping مع إزالة التخصص من القسم القديم أولاً
            Object.entries(savedSettings.deptSpecMapping).forEach(([spec, newDept]) => {
                // إزالة التخصص من أي قسم قديم (لمنع التكرار)
                Object.keys(state.departments).forEach(existingDept => {
                    if (existingDept !== newDept && state.departments[existingDept] instanceof Set) {
                        state.departments[existingDept].delete(spec);
                    }
                });
                // إضافة للقسم الجديد
                if (!state.departments[newDept]) state.departments[newDept] = new Set();
                state.departments[newDept].add(spec);
            });
        }
        if (savedSettings.deptPhones) {
            state.deptPhones = savedSettings.deptPhones;
        }
        // إعادة بناء departments من الإعدادات المحفوظة (استبدال كامل وليس دمج)
        if (savedSettings.departments) {
            Object.entries(savedSettings.departments).forEach(([dept, specs]) => {
                // استبدال set القسم بالكامل بدلاً من الإضافة فوق البيانات القديمة
                state.departments[dept] = new Set(specs);
            });
        }
    }

    // دالة مساعدة لبناء ترويسة الصور المصدرة بنفس تنسيق الطباعة
    function buildImageExportHeader(title, subtitle) {
        const reportHijri = state.reportDate ? getHijriDate(new Date(state.reportDate)) : getHijriDate();
        const college = state.collegeName || 'الكلية التقنية بعنيزة';
        const sem = state.semester || '';
        const printHijri = getHijriDate();
        return `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px double #004226; padding-bottom: 20px; margin-bottom: 30px;">
            <div style="width: 30%; text-align: center; line-height: 1.6; font-size: 15px; color: #393834;">
                <div style="font-weight: 800;">المملكة العربية السعودية</div>
                <div>المؤسسة العامة للتدريب التقني والمهني</div>
                <div style="font-weight: 800;">${college}</div>
            </div>
            <div style="width: 40%; text-align: center;">
                <img src="${window.LOGO_BASE64 || 'logo.png'}" style="max-height: 85px; object-fit: contain; margin-bottom: 10px;">
                <h2 style="color: #004226; font-size: 22px; font-weight: 800; margin: 0 0 5px 0;">${title}</h2>
                ${subtitle ? `<h4 style="color: #775a19; font-size: 17px; font-weight: 700; margin: 0;">${subtitle}</h4>` : ''}
            </div>
            <div style="width: 30%; text-align: center; line-height: 1.6; font-size: 15px; color: #393834;">
                <div style="font-weight: 800;">${sem}</div>
                <div style="margin-top:4px;"><span style="color:#707972">تاريخ التقرير:</span> <span style="font-weight:700">${reportHijri} هـ</span></div>
                <div style="font-size:12px;color:#666;margin-top:4px;font-weight:600;">تاريخ الطباعة: ${printHijri} هـ</div>
            </div>
        </div>`;
    }

    function clearData() {
        let warningMsgs = [];
        
        if (state.rawRows && state.rawRows.length > 0) {
            warningMsgs.push("- بيانات المتدربين المستخرجة من تقرير SF01");
        }
        
        const hasDepts = state.addedDepts && state.addedDepts.size > 0;
        const hasMapping = state.deptSpecMapping && Object.keys(state.deptSpecMapping).length > 0;
        if (hasDepts || hasMapping) {
            warningMsgs.push("- الإعدادات وهيكلة الأقسام التي قمت بتنظيمها");
        }
        
        if (state.deptPhones && Object.keys(state.deptPhones).length > 0) {
            warningMsgs.push("- أرقام جوالات المدربين ورؤساء الأقسام المخزنة");
        }

        let fullMessage = "تنبيه: سيتم تصفير النظام والعودة لضبط المصنع بالكامل.\n\n";
        
        if (warningMsgs.length > 0) {
            fullMessage += "البيانات التالية سيتم مسحها نهائياً:\n" + warningMsgs.join("\n") + "\n\n";
        }
        
        fullMessage += "💡 ملاحظة: إذا كنت تود تحديث البيانات بتقرير جديد فقط، يُرجى استخدام أيقونة (الرفع) المجاورة لتحتفظ بإعداداتك الحالية وتحديث التقرير.\n\n";
        fullMessage += "هل أنت متأكد أنك تريد مسح جميع البيانات؟";

        if (!confirm(fullMessage)) return;
        
        if (_ageInterval) clearInterval(_ageInterval);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SETTINGS_KEY);
        idbClear().finally(() => location.reload());
    }

    function loadNewFile() {
        document.getElementById('mainApp').classList.add('d-none');
        document.getElementById('uploadScreen').classList.remove('d-none');
        document.getElementById('uploadZone').classList.remove('d-none');
        document.getElementById('uploadProgress').classList.add('d-none');
        document.getElementById('savedDataNotice').classList.add('d-none');
    }

    // ===== عمر التقرير وتاريخه =====

    // حساب عمر التقرير
    function calcReportAge(reportDateISO) {
        if (!reportDateISO) return null;
        const reportTime = new Date(reportDateISO).getTime();
        const now = Date.now();
        const diffMs = now - reportTime;
        if (diffMs < 0) return { days: 0, hours: 0, minutes: 0, isOld: false };
        const totalMinutes = Math.floor(diffMs / 60000);
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        const isOld = days >= 1;
        return { days, hours, minutes, isOld };
    }

    // بناء نص عمر التقرير
    function buildAgeHTML(age) {
        if (!age) return '';
        const parts = [];
        if (age.days > 0) {
            parts.push(`<span class="age-segment"><span class="age-value">${age.days}</span><span class="age-label">يوم</span></span>`);
        }
        parts.push(`<span class="age-segment"><span class="age-value">${age.hours}</span><span class="age-label">ساعة</span></span>`);
        parts.push(`<span class="age-segment"><span class="age-value">${age.minutes}</span><span class="age-label">دقيقة</span></span>`);
        return parts.join('<span class="age-divider"></span>');
    }

    // تحديث واجهة عمر التقرير (شاشة الرفع + الشريط العلوي)
    function updateReportAgeUI() {
        if (!state.reportDate) return;
        const age = calcReportAge(state.reportDate);
        if (!age) return;
        const cls = age.isOld ? 'age-warning' : 'age-normal';

        // شاشة الرفع
        const ageEl = document.getElementById('reportAge');
        if (ageEl) {
            ageEl.innerHTML = `<i class="bi bi-hourglass-split"></i> عمر التقرير: ${buildAgeHTML(age)}`;
            ageEl.className = `report-age ${cls}`;
        }

        // الشريط العلوي — شارة العمر المختصرة
        const topAge = document.getElementById('topReportAge');
        if (topAge) {
            const shortAge = age.days > 0 ? `${age.days} يوم ${age.hours} س` : `${age.hours} س ${age.minutes} د`;
            topAge.textContent = shortAge;
            topAge.className = `top-report-age ${cls}`;
        }

        // البوبوفر — عمر مفصل
        const popoverAge = document.getElementById('reportAgeTop');
        if (popoverAge) {
            popoverAge.innerHTML = `<i class="bi bi-hourglass-split"></i> عمر التقرير: ${buildAgeHTML(age)}`;
            popoverAge.className = `report-age ${cls}`;
        }
    }

    // عرض واجهة تاريخ التقرير
    function showReportDateUI() {
        if (!state.reportDate) return;

        const dt = new Date(state.reportDate);
        const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

        // شاشة الرفع
        const section = document.getElementById('reportDateSection');
        const input = document.getElementById('reportDateInput');
        if (section && input) {
            section.classList.remove('d-none');
            input.value = local;
        }

        // الشريط العلوي — شارة التاريخ
        const badge = document.getElementById('topReportDateBadge');
        const topDateSpan = document.getElementById('topReportDate');
        if (badge && topDateSpan) {
            badge.classList.remove('d-none');
            topDateSpan.textContent = dt.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        // البوبوفر — حقل الإدخال
        const inputTop = document.getElementById('reportDateInputTop');
        if (inputTop) {
            inputTop.value = local;
        }

        // تحديث العمر فوراً ثم كل دقيقة
        updateReportAgeUI();
        if (_ageInterval) clearInterval(_ageInterval);
        _ageInterval = setInterval(updateReportAgeUI, 60000);
    }

    // فتح/إغلاق بوبوفر تعديل التاريخ
    function toggleReportDatePopover(e) {
        e.stopPropagation();
        const popover = document.getElementById('reportDatePopover');
        if (!popover) return;
        const isOpen = popover.classList.contains('show');
        if (isOpen) {
            popover.classList.remove('show');
        } else {
            popover.classList.add('show');
            // إغلاق عند النقر خارج البوبوفر
            setTimeout(() => {
                document.addEventListener('click', _closePopoverOnClickOutside, { once: true });
            }, 10);
        }
    }

    function _closePopoverOnClickOutside(e) {
        const popover = document.getElementById('reportDatePopover');
        if (popover && !popover.contains(e.target)) {
            popover.classList.remove('show');
        }
    }

    // تحديث تاريخ التقرير من input
    function updateReportDate(value) {
        if (!value) return;
        state.reportDate = new Date(value).toISOString();
        saveToStorage();
        showReportDateUI();
    }

    // تعيين الوقت الحالي
    function setReportDateNow() {
        state.reportDate = new Date().toISOString();
        saveToStorage();
        showReportDateUI();
    }

    // تصدير صور فردية للمدربين في ملف مضغوط - إلا مقرر واحد
    async function exportImagesDepOne() {
        if (!window.html2canvas || !window.JSZip) {
            alert('يتم تحميل المكتبات، يرجى الانتظار بضع ثوانٍ والمحاولة مرة أخرى.');
            return;
        }
        
        const btn = document.querySelector('button[onclick="App.exportImagesDepOne()"]');
        const oldContent = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جاري المعالجة...';
        btn.disabled = true;

        try {
            const zip = new JSZip();
            const filter = document.getElementById('filterDepOne').value;
            const fiftyBtn = document.getElementById('btnFiftyPercentOne');
            const applyFiftyPct = fiftyBtn && fiftyBtn.classList.contains('active');

            const grouped = {};
            state.deprivedExceptOne.forEach(({ trainee, remainingCourse }) => {
                if (applyFiftyPct) {
                    const totalC = trainee.courses.size;
                    let depC = 0;
                    trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                    if (depC / totalC < 0.5) return;
                }
                const courseDept = getDeptForCourse(remainingCourse);
                if (filter && courseDept !== filter) return;
                const instructor = remainingCourse.instructor || 'غير محدد';
                if (!grouped[courseDept]) grouped[courseDept] = {};
                if (!grouped[courseDept][instructor]) grouped[courseDept][instructor] = [];
                grouped[courseDept][instructor].push({ trainee, course: remainingCourse });
            });

            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.style.top = '-9999px';
            container.style.width = '1200px'; 
            container.style.background = '#fff';
            document.body.appendChild(container);

            let hasAnyContent = false;
            for (const dept of Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar'))) {
                for (const instructor of Object.keys(grouped[dept]).sort((a, b) => a.localeCompare(b, 'ar'))) {
                    const items = grouped[dept][instructor];
                    if (items.length === 0) continue;
                    hasAnyContent = true;

                    let html = `
                    <div style="padding: 40px; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl;">
                        ${buildImageExportHeader('المتدربون المحرومون بجميع المقررات إلا مقرر واحد', 'القسم: ' + dept)}
                        
                        <div style="background: rgba(26,90,58,0.08); padding: 12px; text-align: center; color: #004226; font-weight: 800; font-size: 16px; margin-bottom: 20px; border-radius: 8px;">المدرب: ${instructor}</div>
                        
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px; text-align: center;">
                            <thead>
                                <tr style="background: #e6e9e8; color: #004226;">
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">م</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">رقم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">اسم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">رقم الجوال</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">التخصص</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">المقرر</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">اسم المقرر</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">الرقم المرجعي</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">جدولة</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
                    items.forEach((item, i) => {
                        let trBg = (i%2 === 0 ? 'background: #f8faf9;' : 'background: #ffffff;');
                        html += `<tr style="${trBg} border-bottom: 1px solid #eceeed;">
                            <td style="padding: 10px 8px; font-weight: 600;">${i+1}</td>
                            <td style="padding: 10px 8px;">${item.trainee.id}</td>
                            <td style="padding: 10px 8px; font-weight: 700;">${item.trainee.name}</td>
                            <td style="padding: 10px 8px;">${item.trainee.phone}</td>
                            <td style="padding: 10px 8px;">${item.trainee.spec}</td>
                            <td style="padding: 10px 8px;">${item.course.code}</td>
                            <td style="padding: 10px 8px; white-space: nowrap;">${item.course.name}</td>
                            <td style="padding: 10px 8px;">${item.course.ref}</td>
                            <td style="padding: 10px 8px;">${item.course.schedule}</td>
                        </tr>`;
                    });
                    html += `</tbody></table></div>`;
                    
                    container.innerHTML = html;
                    
                    const canvas = await html2canvas(container.firstElementChild, {
                        scale: 2, 
                        useCORS: true,
                        logging: false
                    });
                    
                    const imgData = canvas.toDataURL('image/jpeg', 0.9);
                    const base64Data = imgData.split(',')[1];
                    const safeInstructor = instructor.replace(/[\\/:*?"<>|]/g, "_");
                    const safeDept = dept.replace(/[\\/:*?"<>|]/g, "_");
                    
                    zip.file(`${safeDept} - ${safeInstructor}.jpg`, base64Data, {base64: true});
                }
            }

            document.body.removeChild(container);

            if (!hasAnyContent) {
                alert('لا توجد بيانات متوافقة مع الفلاتر المحددة لتصديرها كصور.');
                return;
            }

            const content = await zip.generateAsync({type:"blob"});
            const url = URL.createObjectURL(content);
            const a = document.createElement("a");
            a.href = url;
            a.download = `صور مدربين - محرومين إلا مقرر واحد.zip`;
            a.click();
            URL.revokeObjectURL(url);
            
        } catch (err) {
            console.error(err);
            alert('حدث خطأ أثناء تصدير الصور.');
        } finally {
            btn.innerHTML = oldContent;
            btn.disabled = false;
        }
    }

    // تصدير صور فردية للمدربين في ملف مضغوط - إلا مقررين
    async function exportImagesDepTwo() {
        if (!window.html2canvas || !window.JSZip) {
            alert('يتم تحميل المكتبات، يرجى الانتظار بضع ثوانٍ والمحاولة مرة أخرى.');
            return;
        }
        
        const btn = document.querySelector('button[onclick="App.exportImagesDepTwo()"]');
        const oldContent = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جاري المعالجة...';
        btn.disabled = true;

        try {
            const zip = new JSZip();
            const filter = document.getElementById('filterDepTwo').value;
            const fiftyBtn = document.getElementById('btnFiftyPercentTwo');
            const applyFiftyPct = fiftyBtn && fiftyBtn.classList.contains('active');
            const repeatedBtn = document.getElementById('btnRepeatedOnly');
            const showRepeatedOnly = repeatedBtn && repeatedBtn.classList.contains('active');

            const grouped = {};
            state.deprivedExceptTwo.forEach(({ trainee, remainingCourses }) => {
                if (applyFiftyPct) {
                    const totalC = trainee.courses.size;
                    let depC = 0;
                    trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                    if (depC / totalC < 0.5) return;
                }
                remainingCourses.forEach(course => {
                    const courseDept = getDeptForCourse(course);
                    if (filter && courseDept !== filter) return;
                    const instructor = course.instructor || 'غير محدد';
                    if (!grouped[courseDept]) grouped[courseDept] = {};
                    if (!grouped[courseDept][instructor]) grouped[courseDept][instructor] = [];
                    grouped[courseDept][instructor].push({ trainee, course });
                });
            });

            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.style.top = '-9999px';
            container.style.width = '1200px'; 
            container.style.background = '#fff';
            document.body.appendChild(container);

            let hasAnyContent = false;
            for (const dept of Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar'))) {
                for (const instructor of Object.keys(grouped[dept]).sort((a, b) => a.localeCompare(b, 'ar'))) {
                    const items = grouped[dept][instructor];
                    const traineeCounts = {};
                    items.forEach(item => {
                        traineeCounts[item.trainee.id] = (traineeCounts[item.trainee.id] || 0) + 1;
                    });
                    
                    let finalItems = items;
                    if (showRepeatedOnly) {
                        finalItems = items.filter(item => traineeCounts[item.trainee.id] > 1);
                    }
                    if (finalItems.length === 0) continue;
                    hasAnyContent = true;

                    let html = `
                    <div style="padding: 40px; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl;">
                        ${buildImageExportHeader('المتدربون المحرومون بجميع المقررات إلا مقررين', 'القسم: ' + dept)}
                        
                        <div style="background: rgba(26,90,58,0.08); padding: 12px; text-align: center; color: #004226; font-weight: 800; font-size: 16px; margin-bottom: 20px; border-radius: 8px;">المدرب: ${instructor}</div>
                        
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px; text-align: center;">
                            <thead>
                                <tr style="background: #e6e9e8; color: #004226;">
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">م</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">رقم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">اسم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">رقم الجوال</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">التخصص</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">المقرر</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">اسم المقرر</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">الرقم المرجعي</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">جدولة</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
                    finalItems.forEach((item, i) => {
                        const isRepeated = traineeCounts[item.trainee.id] > 1;
                        let trBg = isRepeated ? 'background: rgba(186,26,26,0.1);' : (i%2 === 0 ? 'background: #f8faf9;' : 'background: #ffffff;');
                        html += `<tr style="${trBg} border-bottom: 1px solid #eceeed;">
                            <td style="padding: 10px 8px; font-weight: 600;">${i+1}</td>
                            <td style="padding: 10px 8px;">${item.trainee.id}</td>
                            <td style="padding: 10px 8px; font-weight: 700;">${item.trainee.name}</td>
                            <td style="padding: 10px 8px;">${item.trainee.phone}</td>
                            <td style="padding: 10px 8px;">${item.trainee.spec}</td>
                            <td style="padding: 10px 8px;">${item.course.code}</td>
                            <td style="padding: 10px 8px; white-space: nowrap;">${item.course.name}</td>
                            <td style="padding: 10px 8px;">${item.course.ref}</td>
                            <td style="padding: 10px 8px;">${item.course.schedule}</td>
                        </tr>`;
                    });
                    html += `</tbody></table></div>`;
                    
                    container.innerHTML = html;
                    
                    const canvas = await html2canvas(container.firstElementChild, {
                        scale: 2, 
                        useCORS: true,
                        logging: false
                    });
                    
                    const imgData = canvas.toDataURL('image/jpeg', 0.9);
                    const base64Data = imgData.split(',')[1];
                    const safeInstructor = instructor.replace(/[\\/:*?"<>|]/g, "_");
                    const safeDept = dept.replace(/[\\/:*?"<>|]/g, "_");
                    
                    zip.file(`${safeDept} - ${safeInstructor}.jpg`, base64Data, {base64: true});
                }
            }

            document.body.removeChild(container);

            if (!hasAnyContent) {
                alert('لا توجد بيانات متوافقة مع الفلاتر المحددة لتصديرها كصور.');
                return;
            }

            const content = await zip.generateAsync({type:"blob"});
            const url = URL.createObjectURL(content);
            const a = document.createElement("a");
            a.href = url;
            a.download = `صور مدربين - محرومين إلا مقررين.zip`;
            a.click();
            URL.revokeObjectURL(url);
            
        } catch (err) {
            console.error(err);
            alert('حدث خطأ أثناء تصدير الصور.');
        } finally {
            btn.innerHTML = oldContent;
            btn.disabled = false;
        }
    }

    // تصدير الشامل لجميع الصور في ملف مضغوط واحد
    async function exportAllImagesGlobal() {
        if (!window.html2canvas || !window.JSZip || Object.keys(state.trainees).length === 0) {
            alert('يرجى تحميل ملف بيانات أولاً والانتظار حتى تجهز المكتبات.');
            return;
        }

        const btn = document.getElementById('btnGlobalExport');
        const oldContent = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جاري التصدير...';
        btn.disabled = true;

        try {
            const zip = new JSZip();
            let hasAnyContent = false;

            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.style.top = '-9999px';
            container.style.width = '1200px'; 
            container.style.background = '#fff';
            document.body.appendChild(container);

            // ==========================================
            // 1. (مستمر) محرومون بجميع المقررات
            // ==========================================
            if (state.deprivedAll.length > 0) {
                const groupedAll = {};
                state.deprivedAll.forEach(t => {
                    const spec = t.spec || 'غير محدد';
                    if (!groupedAll[spec]) groupedAll[spec] = [];
                    groupedAll[spec].push(t);
                });

                let htmlAll = `
                <div style="padding: 40px; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl;">
                    ${buildImageExportHeader('(مستمر) محرومون بجميع المقررات', '')}
                `;

                Object.keys(groupedAll).sort((a, b) => a.localeCompare(b, 'ar')).forEach(spec => {
                    const trainees = groupedAll[spec];
                    const dept = state.deptSpecMapping[spec] || trainees[0]?.dept || '';
                    htmlAll += `
                    <div style="background: rgba(26,90,58,0.08); padding: 12px; color: #004226; font-weight: 800; font-size: 16px; margin-bottom: 10px; margin-top: 20px; border-radius: 8px;">القسم: ${dept} - التخصص: ${spec} (${trainees.length})</div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 15px; text-align: center;">
                        <thead>
                            <tr style="background: #e6e9e8; color: #004226;">
                                <th style="padding: 10px; border-bottom: 2px solid #c0c9c0;">م</th>
                                <th style="padding: 10px; border-bottom: 2px solid #c0c9c0;">رقم المتدرب</th>
                                <th style="padding: 10px; border-bottom: 2px solid #c0c9c0;">اسم المتدرب</th>
                                <th style="padding: 10px; border-bottom: 2px solid #c0c9c0;">رقم الجوال</th>
                            </tr>
                        </thead>
                        <tbody>
                    `;
                    trainees.forEach((t, i) => {
                        let trBg = (i%2 === 0 ? 'background: #f8faf9;' : 'background: #ffffff;');
                        htmlAll += `<tr style="${trBg} border-bottom: 1px solid #eceeed;">
                            <td style="padding: 8px; font-weight: 600;">${i+1}</td>
                            <td style="padding: 8px;">${t.id}</td>
                            <td style="padding: 8px; font-weight: 700;">${t.name}</td>
                            <td style="padding: 8px;">${t.phone}</td>
                        </tr>`;
                    });
                    htmlAll += `</tbody></table>`;
                });
                htmlAll += `</div>`;
                
                container.innerHTML = htmlAll;
                const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true, logging: false });
                zip.file(`وكالة شؤون المتدربين - محرومين بالكل.jpg`, canvas.toDataURL('image/jpeg', 0.9).split(',')[1], {base64: true});
                hasAnyContent = true;
            }

            // ==========================================
            // 2. محرومون إلا مقرر واحد (Default: 50% Active)
            // ==========================================
            const groupedOne = {};
            state.deprivedExceptOne.forEach(({ trainee, remainingCourse }) => {
                const totalC = trainee.courses.size;
                let depC = 0;
                trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                if (depC / totalC < 0.5) return; // تطبيق 50 افتراضي

                const courseDept = getDeptForCourse(remainingCourse);
                const instructor = remainingCourse.instructor || 'غير محدد';
                if (!groupedOne[courseDept]) groupedOne[courseDept] = {};
                if (!groupedOne[courseDept][instructor]) groupedOne[courseDept][instructor] = [];
                groupedOne[courseDept][instructor].push({ trainee, course: remainingCourse });
            });

            for (const dept of Object.keys(groupedOne)) {
                for (const instructor of Object.keys(groupedOne[dept])) {
                    const items = groupedOne[dept][instructor];
                    if (items.length === 0) continue;
                    
                    let html = `
                    <div style="padding: 40px; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl;">
                        ${buildImageExportHeader('المتدربون المحرومون بجميع المقررات إلا مقرر واحد', 'القسم: ' + dept)}
                        <div style="background: rgba(26,90,58,0.08); padding: 12px; text-align: center; color: #004226; font-weight: 800; font-size: 16px; margin-bottom: 20px; border-radius: 8px;">المدرب: ${instructor}</div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px; text-align: center;">
                            <thead>
                                <tr style="background: #e6e9e8; color: #004226;">
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">م</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">رقم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">اسم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">التخصص</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">المقرر</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">جدولة</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
                    items.forEach((item, i) => {
                        let trBg = (i%2 === 0 ? 'background: #f8faf9;' : 'background: #ffffff;');
                        html += `<tr style="${trBg} border-bottom: 1px solid #eceeed;">
                            <td style="padding: 10px 8px; font-weight: 600;">${i+1}</td>
                            <td style="padding: 10px 8px;">${item.trainee.id}</td>
                            <td style="padding: 10px 8px; font-weight: 700;">${item.trainee.name}</td>
                            <td style="padding: 10px 8px;">${item.trainee.spec}</td>
                            <td style="padding: 10px 8px;">${item.course.name}</td>
                            <td style="padding: 10px 8px;">${item.course.schedule}</td>
                        </tr>`;
                    });
                    html += `</tbody></table></div>`;
                    
                    container.innerHTML = html;
                    const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true, logging: false });
                    const safeInstructor = instructor.replace(/[\\/:*?"<>|]/g, "_");
                    const safeDept = dept.replace(/[\\/:*?"<>|]/g, "_");
                    zip.file(`محرومون إلا مقرر/${safeDept} - ${safeInstructor}.jpg`, canvas.toDataURL('image/jpeg', 0.9).split(',')[1], {base64: true});
                    hasAnyContent = true;
                }
            }

            // ==========================================
            // 3. محرومون إلا مقررين (Default: 50% Active, Repeated Only Active)
            // ==========================================
            const groupedTwo = {};
            state.deprivedExceptTwo.forEach(({ trainee, remainingCourses }) => {
                const totalC = trainee.courses.size;
                let depC = 0;
                trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                if (depC / totalC < 0.5) return; // 50% افتراضي

                remainingCourses.forEach(course => {
                    const courseDept = getDeptForCourse(course);
                    const instructor = course.instructor || 'غير محدد';
                    if (!groupedTwo[courseDept]) groupedTwo[courseDept] = {};
                    if (!groupedTwo[courseDept][instructor]) groupedTwo[courseDept][instructor] = [];
                    groupedTwo[courseDept][instructor].push({ trainee, course });
                });
            });

            for (const dept of Object.keys(groupedTwo)) {
                for (const instructor of Object.keys(groupedTwo[dept])) {
                    const items = groupedTwo[dept][instructor];
                    const traineeCounts = {};
                    items.forEach(item => {
                        traineeCounts[item.trainee.id] = (traineeCounts[item.trainee.id] || 0) + 1;
                    });
                    
                    // مكررون فقط افتراضي
                    const finalItems = items.filter(item => traineeCounts[item.trainee.id] > 1);
                    if (finalItems.length === 0) continue;

                    let html = `
                    <div style="padding: 40px; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl;">
                        ${buildImageExportHeader('المتدربون المحرومون بجميع المقررات إلا مقررين', 'القسم: ' + dept)}
                        <div style="background: rgba(26,90,58,0.08); padding: 12px; text-align: center; color: #004226; font-weight: 800; font-size: 16px; margin-bottom: 20px; border-radius: 8px;">المدرب: ${instructor}</div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px; text-align: center;">
                            <thead>
                                <tr style="background: #e6e9e8; color: #004226;">
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">م</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">رقم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">اسم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">التخصص</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">المقرر</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">جدولة</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
                    finalItems.forEach((item, i) => {
                        let trBg = 'background: rgba(186,26,26,0.1);'; // Because they are all repeated
                        html += `<tr style="${trBg} border-bottom: 1px solid #eceeed;">
                            <td style="padding: 10px 8px; font-weight: 600;">${i+1}</td>
                            <td style="padding: 10px 8px;">${item.trainee.id}</td>
                            <td style="padding: 10px 8px; font-weight: 700;">${item.trainee.name}</td>
                            <td style="padding: 10px 8px;">${item.trainee.spec}</td>
                            <td style="padding: 10px 8px;">${item.course.name}</td>
                            <td style="padding: 10px 8px;">${item.course.schedule}</td>
                        </tr>`;
                    });
                    html += `</tbody></table></div>`;
                    
                    container.innerHTML = html;
                    const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true, logging: false });
                    const safeInstructor = instructor.replace(/[\\/:*?"<>|]/g, "_");
                    const safeDept = dept.replace(/[\\/:*?"<>|]/g, "_");
                    zip.file(`محرومون إلا مقررين/${safeDept} - ${safeInstructor}.jpg`, canvas.toDataURL('image/jpeg', 0.9).split(',')[1], {base64: true});
                    hasAnyContent = true;
                }
            }

            document.body.removeChild(container);

            if (!hasAnyContent) {
                alert('لا يوجد أي بيانات متوافقة للتصدير.');
                return;
            }

            const content = await zip.generateAsync({type:"blob"});
            const url = URL.createObjectURL(content);
            const a = document.createElement("a");
            a.href = url;
            a.download = `حزمة صور المدربين الشاملة.zip`;
            a.click();
            URL.revokeObjectURL(url);
            
        } catch (err) {
            console.error(err);
            alert('حدث خطأ أثناء تصدير الصور الشامل.');
        } finally {
            btn.innerHTML = oldContent;
            btn.disabled = false;
        }
    }

    // --- توليد الإيميلات (EML) ---
    function utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    function createEmlContent(base64Image, instructorName, deptName, tabName) {
        const boundary = "----=_NextPart_" + Date.now().toString(16);
        const subject = `تنبيه حرمان (${tabName}) - ${deptName}${instructorName ? ' - ' + instructorName : ''}`;
        const encodedSubject = `=?utf-8?B?${utf8ToBase64(subject)}?=`;

        let greeting = instructorName ? `سعادة المدرب المحترم/ <span style="color:#004226;font-weight:bold;">${instructorName}</span>،` : `السادة الكرام،`;
        const htmlBody = `
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="utf-8">
            </head>
            <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 14pt; color: #333; line-height: 1.6;">
                <p>${greeting}</p>
                <p>السلام عليكم ورحمة الله وبركاته،</p>
                <p>نُرفق لكم في هذا البريد صورة إحصائية توضح تفاصيل المتدربين ضمن متابعة الحرمان لتبويب: <strong style="color: #ba1a1a;">${tabName}</strong>.</p>
                <p>يرجى التكرم بالاطلاع والمتابعة.</p>
                <br>
                <p>مع أطيب التحيات،<br><b style="color: #0f6c44;">وكالة شؤون المتدربين - ${state.collegeName || 'الكلية التقنية بعنيزة'}</b></p>
            </body>
            </html>
        `;

        const encodedBody = utf8ToBase64(htmlBody);
        const chunkedImage = base64Image.match(/.{1,76}/g).join('\r\n');

        return [
            `MIME-Version: 1.0`,
            `Subject: ${encodedSubject}`,
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            ``,
            `--${boundary}`,
            `Content-Type: text/html; charset="UTF-8"`,
            `Content-Transfer-Encoding: base64`,
            ``,
            encodedBody,
            ``,
            `--${boundary}`,
            `Content-Type: image/jpeg; name="report.jpg"`,
            `Content-Transfer-Encoding: base64`,
            `Content-Disposition: attachment; filename="report.jpg"`,
            ``,
            chunkedImage,
            `--${boundary}--`
        ].join('\r\n');
    }

    async function exportAllEmailsGlobal() {
        if (!window.html2canvas || !window.JSZip || Object.keys(state.trainees).length === 0) {
            alert('يرجى تحميل ملف بيانات أولاً والانتظار حتى تجهز المكتبات.');
            return;
        }

        const btn = document.getElementById('btnGlobalEmail');
        const oldContent = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جاري التصدير...';
        btn.disabled = true;

        try {
            const zip = new JSZip();
            let hasAnyContent = false;

            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.style.top = '-9999px';
            container.style.width = '1200px'; 
            container.style.background = '#fff';
            document.body.appendChild(container);

            // 1. محرومون بجميع المقررات
            if (state.deprivedAll.length > 0) {
                const groupedAll = {};
                state.deprivedAll.forEach(t => {
                    const spec = t.spec || 'غير محدد';
                    if (!groupedAll[spec]) groupedAll[spec] = [];
                    groupedAll[spec].push(t);
                });

                let htmlAll = `
                <div style="padding: 40px; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl;">
                    ${buildImageExportHeader('(مستمر) محرومون بجميع المقررات', '')}
                `;

                Object.keys(groupedAll).sort((a, b) => a.localeCompare(b, 'ar')).forEach(spec => {
                    const trainees = groupedAll[spec];
                    const dept = state.deptSpecMapping[spec] || trainees[0]?.dept || '';
                    htmlAll += `
                    <div style="background: rgba(26,90,58,0.08); padding: 12px; color: #004226; font-weight: 800; font-size: 16px; margin-bottom: 10px; margin-top: 20px; border-radius: 8px;">القسم: ${dept} - التخصص: ${spec} (${trainees.length})</div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 15px; text-align: center;">
                        <thead>
                            <tr style="background: #e6e9e8; color: #004226;">
                                <th style="padding: 10px; border-bottom: 2px solid #c0c9c0;">م</th>
                                <th style="padding: 10px; border-bottom: 2px solid #c0c9c0;">رقم المتدرب</th>
                                <th style="padding: 10px; border-bottom: 2px solid #c0c9c0;">اسم المتدرب</th>
                                <th style="padding: 10px; border-bottom: 2px solid #c0c9c0;">رقم الجوال</th>
                            </tr>
                        </thead>
                        <tbody>
                    `;
                    trainees.forEach((t, i) => {
                        let trBg = (i%2 === 0 ? 'background: #f8faf9;' : 'background: #ffffff;');
                        htmlAll += `<tr style="${trBg} border-bottom: 1px solid #eceeed;">
                            <td style="padding: 8px; font-weight: 600;">${i+1}</td>
                            <td style="padding: 8px;">${t.id}</td>
                            <td style="padding: 8px; font-weight: 700;">${t.name}</td>
                            <td style="padding: 8px;">${t.phone}</td>
                        </tr>`;
                    });
                    htmlAll += `</tbody></table>`;
                });
                htmlAll += `</div>`;
                
                container.innerHTML = htmlAll;
                const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true, logging: false });
                const b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
                const eml = createEmlContent(b64, '', 'جميع الأقسام', 'مستمر محرومون بالكل');
                zip.file(`وكالة شؤون المتدربين - محرومين بالكل.eml`, eml);
                hasAnyContent = true;
            }

            // 2. محرومون إلا مقرر واحد
            const groupedOne = {};
            state.deprivedExceptOne.forEach(({ trainee, remainingCourse }) => {
                const totalC = trainee.courses.size;
                let depC = 0;
                trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                if (depC / totalC < 0.5) return;

                const courseDept = getDeptForCourse(remainingCourse);
                const instructor = remainingCourse.instructor || 'غير محدد';
                if (!groupedOne[courseDept]) groupedOne[courseDept] = {};
                if (!groupedOne[courseDept][instructor]) groupedOne[courseDept][instructor] = [];
                groupedOne[courseDept][instructor].push({ trainee, course: remainingCourse });
            });

            for (const dept of Object.keys(groupedOne)) {
                for (const instructor of Object.keys(groupedOne[dept])) {
                    const items = groupedOne[dept][instructor];
                    if (items.length === 0) continue;
                    
                    let html = `
                    <div style="padding: 40px; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl;">
                        ${buildImageExportHeader('المتدربون المحرومون بجميع المقررات إلا مقرر واحد', 'القسم: ' + dept)}
                        <div style="background: rgba(26,90,58,0.08); padding: 12px; text-align: center; color: #004226; font-weight: 800; font-size: 16px; margin-bottom: 20px; border-radius: 8px;">المدرب: ${instructor}</div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px; text-align: center;">
                            <thead>
                                <tr style="background: #e6e9e8; color: #004226;">
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">م</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">رقم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">اسم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">التخصص</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">المقرر</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">جدولة</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
                    items.forEach((item, i) => {
                        let trBg = (i%2 === 0 ? 'background: #f8faf9;' : 'background: #ffffff;');
                        html += `<tr style="${trBg} border-bottom: 1px solid #eceeed;">
                            <td style="padding: 10px 8px; font-weight: 600;">${i+1}</td>
                            <td style="padding: 10px 8px;">${item.trainee.id}</td>
                            <td style="padding: 10px 8px; font-weight: 700;">${item.trainee.name}</td>
                            <td style="padding: 10px 8px;">${item.trainee.spec}</td>
                            <td style="padding: 10px 8px;">${item.course.name}</td>
                            <td style="padding: 10px 8px;">${item.course.schedule}</td>
                        </tr>`;
                    });
                    html += `</tbody></table></div>`;
                    
                    container.innerHTML = html;
                    const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true, logging: false });
                    const b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
                    const eml = createEmlContent(b64, instructor, dept, 'محرومون إلا مقرر واحد');
                    
                    const safeInstructor = instructor.replace(/[\\/:*?"<>|]/g, "_");
                    const safeDept = dept.replace(/[\\/:*?"<>|]/g, "_");
                    zip.file(`محرومون إلا مقرر/${safeDept} - ${safeInstructor}.eml`, eml);
                    hasAnyContent = true;
                }
            }

            // 3. محرومون إلا مقررين
            const groupedTwo = {};
            state.deprivedExceptTwo.forEach(({ trainee, remainingCourses }) => {
                const totalC = trainee.courses.size;
                let depC = 0;
                trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                if (depC / totalC < 0.5) return;

                remainingCourses.forEach(course => {
                    const courseDept = getDeptForCourse(course);
                    const instructor = course.instructor || 'غير محدد';
                    if (!groupedTwo[courseDept]) groupedTwo[courseDept] = {};
                    if (!groupedTwo[courseDept][instructor]) groupedTwo[courseDept][instructor] = [];
                    groupedTwo[courseDept][instructor].push({ trainee, course });
                });
            });

            for (const dept of Object.keys(groupedTwo)) {
                for (const instructor of Object.keys(groupedTwo[dept])) {
                    const items = groupedTwo[dept][instructor];
                    const traineeCounts = {};
                    items.forEach(item => {
                        traineeCounts[item.trainee.id] = (traineeCounts[item.trainee.id] || 0) + 1;
                    });
                    
                    const finalItems = items.filter(item => traineeCounts[item.trainee.id] > 1);
                    if (finalItems.length === 0) continue;

                    let html = `
                    <div style="padding: 40px; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl;">
                        ${buildImageExportHeader('المتدربون المحرومون بجميع المقررات إلا مقررين', 'القسم: ' + dept)}
                        <div style="background: rgba(26,90,58,0.08); padding: 12px; text-align: center; color: #004226; font-weight: 800; font-size: 16px; margin-bottom: 20px; border-radius: 8px;">المدرب: ${instructor}</div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 15px; text-align: center;">
                            <thead>
                                <tr style="background: #e6e9e8; color: #004226;">
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">م</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">رقم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">اسم المتدرب</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">التخصص</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">المقرر</th>
                                    <th style="padding: 12px 8px; border-bottom: 2px solid #c0c9c0; font-weight: 800;">جدولة</th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
                    finalItems.forEach((item, i) => {
                        let trBg = 'background: rgba(186,26,26,0.1);';
                        html += `<tr style="${trBg} border-bottom: 1px solid #eceeed;">
                            <td style="padding: 10px 8px; font-weight: 600;">${i+1}</td>
                            <td style="padding: 10px 8px;">${item.trainee.id}</td>
                            <td style="padding: 10px 8px; font-weight: 700;">${item.trainee.name}</td>
                            <td style="padding: 10px 8px;">${item.trainee.spec}</td>
                            <td style="padding: 10px 8px;">${item.course.name}</td>
                            <td style="padding: 10px 8px;">${item.course.schedule}</td>
                        </tr>`;
                    });
                    html += `</tbody></table></div>`;
                    
                    container.innerHTML = html;
                    const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true, logging: false });
                    const b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
                    const eml = createEmlContent(b64, instructor, dept, 'محرومون إلا مقررين');
                    
                    const safeInstructor = instructor.replace(/[\\/:*?"<>|]/g, "_");
                    const safeDept = dept.replace(/[\\/:*?"<>|]/g, "_");
                    zip.file(`محرومون إلا مقررين/${safeDept} - ${safeInstructor}.eml`, eml);
                    hasAnyContent = true;
                }
            }

            document.body.removeChild(container);

            if (!hasAnyContent) {
                alert('لا يوجد أي بيانات متوافقة للتصدير.');
                return;
            }

            const content = await zip.generateAsync({type:"blob"});
            const url = URL.createObjectURL(content);
            const a = document.createElement("a");
            a.href = url;
            a.download = `حزمة إيميلات المدربين الجاهزة.zip`;
            a.click();
            URL.revokeObjectURL(url);
            
        } catch (err) {
            console.error(err);
            alert('حدث خطأ أثناء تصدير الإيميلات الشاملة.');
        } finally {
            btn.innerHTML = oldContent;
            btn.disabled = false;
        }
    }

    // تفعيل / تعطيل خيار الـ 50%
    function toggleFiftyPct(tabType) {
        const btn = document.getElementById(`btnFiftyPercent${tabType}`);
        if (btn) {
            btn.classList.toggle('active');
            if (tabType === 'One') renderDepOne();
            else if (tabType === 'Two') renderDepTwo();
        }
    }

    function toggleRepeatedOnly() {
        const btn = document.getElementById('btnRepeatedOnly');
        if (btn) {
            btn.classList.toggle('active');
            renderDepTwo();
        }
    }

    // ===== التشغيل =====
    document.addEventListener('DOMContentLoaded', init);

    // --- حفظ رقم جوال القسم للواتساب ---
    function saveDeptPhone(dept, val, btnElement, inputId) {
        val = val.trim();
        let digits = val.replace(/\D/g, '');
        
        // توحيد الصيغة إلى 05XXXXXXX أو ما يعادلها
        if (digits.startsWith('9665') || digits.startsWith('9661')) {
            digits = '0' + digits.substring(3);
        } else if (digits.startsWith('5')) {
            digits = '0' + digits;
        }

        if (digits.length > 0 && digits.length < 9) {
            alert('رقم الجوال يبدو ناقصاً، تأكد من إدخال رقم صحيح.');
            return;
        }

        state.deptPhones[dept] = digits;
        saveToStorage();

        // تحديث الحقل البصري ليظهر الرقم الموحد
        if (inputId) {
            const inputEl = document.getElementById(inputId);
            if (inputEl) inputEl.value = digits;
        }

        // تأثير بصري للحفظ
        if (btnElement) {
            const originalHtml = btnElement.innerHTML;
            btnElement.innerHTML = '<i class="bi bi-check-lg"></i>';
            btnElement.classList.remove('btn-outline-success');
            btnElement.classList.add('btn-success');
            btnElement.style.color = '#fff';
            setTimeout(() => {
                btnElement.innerHTML = originalHtml;
                btnElement.classList.remove('btn-success');
                btnElement.classList.add('btn-outline-success');
                btnElement.style.color = '';
            }, 1500);
        }
    }

    // --- إرسال الواتساب للمدربين في القسم ---
    function sendWhatsAppMessage(tabType, dept) {
        let phone = (state.deptPhones[dept] || '').replace(/\D/g, '');
        if (!phone) {
            alert('الرجاء الانتقال لتبويب (تنظيم الأقسام) وإدخال رقم جوال رئيس هذا القسم أولاً.');
            return;
        }
        
        // تحويل تلقائي للصيغة السعودية الدولية للواتساب
        if (phone.startsWith('0')) {
            phone = '966' + phone.substring(1);
        }

        const semName = state.semester || 'الفصل الحالي';
        let msg = `*إحصائية الحرمان - ${dept}*\n${semName}\n\n======================\n`;

        const grouped = {};
        if (tabType === 'DepOne') {
            const applyFiftyPct = document.getElementById('btnFiftyPercentOne')?.classList.contains('active');
            state.deprivedExceptOne.forEach(({ trainee, remainingCourse }) => {
                if (applyFiftyPct) {
                    const totalC = trainee.courses.size;
                    let depC = 0;
                    trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                    if (depC / totalC < 0.5) return;
                }
                const cDept = getDeptForCourse(remainingCourse);
                if (cDept === dept) {
                    const inst = remainingCourse.instructor || 'غير محدد';
                    if (!grouped[inst]) grouped[inst] = [];
                    grouped[inst].push({ trainee, course: remainingCourse, repeated: false });
                }
            });
        } else if (tabType === 'DepTwo') {
            const applyFiftyPct = document.getElementById('btnFiftyPercentTwo')?.classList.contains('active');
            const showRepeatedOnly = document.getElementById('btnRepeatedOnly')?.classList.contains('active');
            
            const tmpGrp = {};
            state.deprivedExceptTwo.forEach(({ trainee, remainingCourses }) => {
                if (applyFiftyPct) {
                    const totalC = trainee.courses.size;
                    let depC = 0;
                    trainee.courses.forEach(crs => { if (crs.deprived) depC++; });
                    if (depC / totalC < 0.5) return;
                }
                remainingCourses.forEach(course => {
                    const cDept = getDeptForCourse(course);
                    if (cDept === dept) {
                        const inst = course.instructor || 'غير محدد';
                        if (!tmpGrp[inst]) tmpGrp[inst] = [];
                        tmpGrp[inst].push({ trainee, course });
                    }
                });
            });

            for (const inst in tmpGrp) {
                const traineeCounts = {};
                tmpGrp[inst].forEach(item => {
                    traineeCounts[item.trainee.id] = (traineeCounts[item.trainee.id] || 0) + 1;
                });
                
                let finalItems = tmpGrp[inst];
                if (showRepeatedOnly) {
                    finalItems = tmpGrp[inst].filter(item => traineeCounts[item.trainee.id] > 1);
                }
                if (finalItems.length > 0) {
                    grouped[inst] = finalItems.map(i => ({
                        trainee: i.trainee,
                        course: i.course,
                        repeated: traineeCounts[i.trainee.id] > 1
                    }));
                }
            }
        }

        if (Object.keys(grouped).length === 0) {
            alert('لا توجد بيانات ليتم إرسالها.');
            return;
        }

        Object.keys(grouped).sort((a,b) => a.localeCompare(b,'ar')).forEach(inst => {
            msg += `المدرب: *${inst}*\n`;
            grouped[inst].forEach((item, idx) => {
                let rFlag = item.repeated ? ' - *مكرر*' : '';
                msg += `${idx + 1}. ${item.trainee.name} (${item.course.name})${rFlag}\n`;
            });
            msg += `\n`;
        });

        msg += `======================\n`;
        msg += `الرجاء التكرم بمتابعة المدربين وحثهم على التأكد من وضع المتدربين وتحضيرهم.\nمع التحية، وكالة شؤون المدربين.`;

        const waLink = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
        window.open(waLink, '_blank');
    }

    return {
        renderDepAll, renderDepOne, renderDepTwo,
        printSummary, printDepAll, printDepOne, printDepTwo,
        saveCollegeName, unlinkSpec,
        showAddDeptInput, addDeptFromBoard,
        clearData, loadNewFile,
        setPercentMode,
        updateReportDate, setReportDateNow, toggleReportDatePopover,
        toggleFiftyPct, toggleRepeatedOnly, exportImagesDepOne, exportImagesDepTwo, exportAllImagesGlobal, exportAllEmailsGlobal,
        saveDeptPhone, sendWhatsAppMessage
    };
})();
