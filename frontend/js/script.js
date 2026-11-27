document.addEventListener("DOMContentLoaded", function () {

    /* ========================================
       一、登入頁面基本互動
    ======================================== */

    const loginForm = document.getElementById("loginForm");

    if (loginForm) {
        const captchaCode = document.getElementById("captchaCode");
        const refreshCaptcha = document.getElementById("refreshCaptcha");
        const loginMessage = document.getElementById("loginMessage");
        const rememberAccount = document.getElementById("rememberAccount");
        const accountInput = document.getElementById("account");
        const passwordInput = document.getElementById("password");
        const captchaInput = document.getElementById("captcha");
        const forgotPassword = document.getElementById("forgotPassword");

        function generateCaptcha() {
            if (!captchaCode) return;
            captchaCode.textContent = Math.floor(1000 + Math.random() * 9000);
        }

        generateCaptcha();

        if (refreshCaptcha) {
            refreshCaptcha.addEventListener("click", function () {
                generateCaptcha();
                if (captchaInput) captchaInput.value = "";
            });
        }

        if (accountInput && rememberAccount) {
            const savedAccount = localStorage.getItem("savedAccount");
            if (savedAccount) {
                accountInput.value = savedAccount;
                rememberAccount.checked = true;
            }
        }

        loginForm.addEventListener("submit", function (event) {
            event.preventDefault();

            if (!accountInput || !passwordInput || !captchaInput ||
                !captchaCode || !loginMessage) return;

            const account = accountInput.value.trim();
            const password = passwordInput.value;
            const captcha = captchaInput.value.trim();

            loginMessage.style.color = "#d64545";

            if (!account) {
                loginMessage.textContent = "請輸入帳號";
                return;
            }
            if (!password) {
                loginMessage.textContent = "請輸入密碼";
                return;
            }
            if (!captcha) {
                loginMessage.textContent = "請輸入驗證碼";
                return;
            }
            if (captcha !== captchaCode.textContent) {
                loginMessage.textContent = "驗證碼錯誤，請重新輸入";
                generateCaptcha();
                captchaInput.value = "";
                return;
            }

            if (rememberAccount && rememberAccount.checked) {
                localStorage.setItem("savedAccount", account);
            } else {
                localStorage.removeItem("savedAccount");
            }

            // 示範帳號分流：管理者帳號以 A 開頭或為 admin／manager
            const isAdmin =
                /^A/i.test(account) ||
                account.toLowerCase() === "admin" ||
                account.toLowerCase() === "manager";

            sessionStorage.setItem("demoUserAccount", account);
            sessionStorage.setItem("demoUserRole", isAdmin ? "admin" : "student");

            loginMessage.style.color = "#2e9b68";
            loginMessage.textContent = isAdmin
                ? "登入成功，正在進入管理者畫面…"
                : "登入成功，正在進入學生畫面…";

            setTimeout(function () {
                window.location.href = isAdmin ? "admin.html" : "student.html";
            }, 500);
        });

        if (forgotPassword) {
            forgotPassword.addEventListener("click", function (event) {
                event.preventDefault();
                alert("忘記密碼功能尚未完成，之後將接上系統功能。");
            });
        }
    }


    /* ========================================
       二、學生端功能選單切換
    ======================================== */

    const menuItems = document.querySelectorAll(".menu-item");
    const contentSections = document.querySelectorAll(".content-section");

    // 學生端選單：管理者頁由下方 admin 區塊自行處理，避免互相覆寫
    if (
        menuItems.length &&
        contentSections.length &&
        !document.body.classList.contains("admin-page")
    ) {
        const pageTitle = document.getElementById("pageTitle");
        const pageBreadcrumb = document.getElementById("pageBreadcrumb");

        const pageNames = {
            "course-search": "課程查詢",
            "course-compare": "課程比較",
            "course-schedule": "預選課模擬",
            "account": "個人帳號"
        };

        function switchPage(targetId) {
            const targetSection = document.getElementById(targetId);
            if (!targetSection) return;

            menuItems.forEach(menu => menu.classList.remove("active"));
            contentSections.forEach(section => section.classList.remove("active"));

            const activeMenu = document.querySelector(
                '.menu-item[data-target="' + targetId + '"]'
            );
            if (activeMenu) activeMenu.classList.add("active");

            targetSection.classList.add("active");

            const currentName = pageNames[targetId] || "學生功能";
            if (pageTitle) pageTitle.textContent = currentName;
            if (pageBreadcrumb) {
                pageBreadcrumb.textContent = "學生端 / " + currentName;
            }
        }

        menuItems.forEach(item => {
            item.addEventListener("click", function () {
                switchPage(item.dataset.target);
            });
        });

        const initialMenu = document.querySelector(".menu-item.active");
        switchPage(initialMenu ? initialMenu.dataset.target : "course-search");
    }


    /* ========================================
       三、課程查詢功能
       每頁顯示 5 筆；支援條件篩選與分頁
    ======================================== */

    const courseTableBody = document.getElementById("courseTableBody");

    if (courseTableBody) {

        // 示範課程資料：非學校正式課程資料
        const courses = [
            { id: 1, semester: "115-1", department: "資訊管理系", grade: "二年級", type: "必修", program: "日間部", name: "資料庫管理", teacher: "王老師", className: "資管二A", credits: 3, day: "星期一", period: "3-4", classroom: "G202", students: 45 },
            { id: 2, semester: "115-1", department: "資訊管理系", grade: "二年級", type: "必修", program: "日間部", name: "網頁程式設計", teacher: "林老師", className: "資管二A", credits: 3, day: "星期二", period: "5-6", classroom: "F101", students: 40 },
            { id: 3, semester: "115-1", department: "資訊管理系", grade: "二年級", type: "必修", program: "日間部", name: "系統分析與設計", teacher: "陳老師", className: "資管二A", credits: 3, day: "星期三", period: "3-4", classroom: "G202", students: 42 },
            { id: 4, semester: "115-1", department: "資訊管理系", grade: "二年級", type: "必修", program: "日間部", name: "資訊管理概論", teacher: "張老師", className: "資管二A", credits: 2, day: "星期四", period: "1-2", classroom: "F201", students: 50 },
            { id: 5, semester: "115-1", department: "資訊管理系", grade: "二年級", type: "選修", program: "日間部", name: "數位媒體設計", teacher: "李老師", className: "資管二A", credits: 2, day: "星期五", period: "5-6", classroom: "E101", students: 35 },
            { id: 6, semester: "115-1", department: "健康事業管理系", grade: "一年級", type: "必修", program: "日間部", name: "健康產業概論", teacher: "周老師", className: "健管一A", credits: 2, day: "星期一", period: "1-2", classroom: "B301", students: 48 },
            { id: 7, semester: "115-1", department: "健康事業管理系", grade: "二年級", type: "選修", program: "日間部", name: "醫療品質管理", teacher: "吳老師", className: "健管二A", credits: 2, day: "星期二", period: "3-4", classroom: "B302", students: 36 },
            { id: 8, semester: "115-1", department: "護理系", grade: "一年級", type: "必修", program: "日間部", name: "基礎護理學", teacher: "許老師", className: "護理一A", credits: 3, day: "星期三", period: "1-2", classroom: "N201", students: 52 },
            { id: 9, semester: "114-2", department: "資訊管理系", grade: "三年級", type: "選修", program: "日間部", name: "使用者介面設計", teacher: "鄭老師", className: "資管三A", credits: 2, day: "星期四", period: "3-4", classroom: "F202", students: 30 },
            { id: 10, semester: "114-2", department: "資訊管理系", grade: "二年級", type: "必修", program: "進修部", name: "程式設計", teacher: "黃老師", className: "資管二B", credits: 3, day: "星期五", period: "1-2", classroom: "G101", students: 39 },
            { id: 11, semester: "114-1", department: "健康事業管理系", grade: "三年級", type: "選修", program: "進修部", name: "健康資料分析", teacher: "蔡老師", className: "健管三B", credits: 2, day: "星期一", period: "5-6", classroom: "B303", students: 28 },
            { id: 12, semester: "114-1", department: "護理系", grade: "二年級", type: "必修", program: "日間部", name: "成人護理學", teacher: "劉老師", className: "護理二A", credits: 3, day: "星期二", period: "1-2", classroom: "N202", students: 46 }
        ];

        const pageSize = 5;
        let filteredCourses = courses.slice();
        let currentPage = 1;

        // 儲存已勾選的比較課程，切換分頁或查詢條件時仍會保留
        const selectedCompareIds = new Set();
        const maxCompareCourses = 3;

        const semesterSelect = document.getElementById("filterSemester");
        const departmentSelect = document.getElementById("filterDepartment");
        const gradeSelect = document.getElementById("filterGrade");
        const typeSelect = document.getElementById("filterType");
        const programSelect = document.getElementById("filterProgram");
        const daySelect = document.getElementById("filterDay");
        const keywordInput = document.getElementById("filterKeyword");
        const resultCount = document.getElementById("resultCount");
        const paginationInfo = document.getElementById("paginationInfo");
        const pageButtons = document.getElementById("pageButtons");
        const prevPage = document.getElementById("prevPage");
        const nextPage = document.getElementById("nextPage");

        function renderCourses() {
            const totalPages = Math.max(1, Math.ceil(filteredCourses.length / pageSize));
            currentPage = Math.min(currentPage, totalPages);

            const startIndex = (currentPage - 1) * pageSize;
            const pageCourses = filteredCourses.slice(startIndex, startIndex + pageSize);

            courseTableBody.innerHTML = "";

            if (pageCourses.length === 0) {
                courseTableBody.innerHTML =
                    '<tr><td colspan="10" class="empty-result">查無符合條件的課程</td></tr>';
            } else {
                pageCourses.forEach(course => {
                    const row = document.createElement("tr");
                    row.innerHTML = `
                        <td><input type="checkbox" class="compare-checkbox" value="${course.id}" ${selectedCompareIds.has(course.id) ? "checked" : ""} aria-label="選擇比較 ${course.name}"></td>
                        <td>${course.name}</td>
                        <td>${course.teacher}</td>
                        <td>${course.className}</td>
                        <td>${course.credits}</td>
                        <td>${course.type}</td>
                        <td>${course.day.replace("星期", "")} ${course.period}</td>
                        <td><a href="#" class="classroom-link">${course.classroom}</a></td>
                        <td>${course.students}</td>
                        <td>
							<button
								type="button"
								class="small-button add-course-button"
								data-course-id="${course.id}">
								${selectedScheduleIds.has(course.id) ? "移除預選" : "加入預選"}
							</button>
						</td>
                    `;
                    courseTableBody.appendChild(row);
                });
            }

            if (resultCount) {
                resultCount.textContent = "查詢結果：共 " + filteredCourses.length + " 筆課程";
            }
            if (paginationInfo) {
                paginationInfo.textContent = "第 " + currentPage + " 頁 / 共 " + totalPages + " 頁";
            }
            if (prevPage) prevPage.disabled = currentPage === 1;
            if (nextPage) nextPage.disabled = currentPage === totalPages;

            if (pageButtons) {
                pageButtons.innerHTML = "";
                for (let page = 1; page <= totalPages; page++) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "page-number" + (page === currentPage ? " active" : "");
                    button.textContent = page;
                    button.addEventListener("click", function () {
                        currentPage = page;
                        renderCourses();
                    });
                    pageButtons.appendChild(button);
                }
            }
			// 更新課程列表中的預選按鈕狀態
			const addButtons = courseTableBody.querySelectorAll(".add-course-button");

			addButtons.forEach(button => {
				const courseId = Number(button.dataset.courseId);

				if (selectedScheduleIds.has(courseId)) {
					button.textContent = "移除預選";
					button.disabled = false;
				} else {
					button.textContent = "加入預選";
					button.disabled = false;
				}
			});
        }

        /* 課程比較：將已勾選的課程整理成比較表 */
        const compareCourseList = document.getElementById("compareCourseList");
        const compareCount = document.getElementById("compareCount");
        const startCompareButton = document.getElementById("startCompare");

        function updateCompareCount() {
            if (compareCount) {
                compareCount.textContent =
                    "目前選擇 " + selectedCompareIds.size + " / " + maxCompareCourses + " 門課程";
            }
            if (startCompareButton) {
                startCompareButton.textContent =
                    "開始比較 (" + selectedCompareIds.size + "/3)";
            }
        }

        function renderCompareCourses() {
            if (!compareCourseList) return;

            const selectedCourses = courses.filter(course =>
                selectedCompareIds.has(course.id)
            );

            updateCompareCount();

            if (selectedCourses.length === 0) {
                compareCourseList.innerHTML =
                    '<p class="empty-result">尚未選擇課程，請返回課程查詢頁勾選課程。</p>';
                return;
            }

            const comparisonRows = [
                ["課程名稱", course => course.name],
                ["開課系所", course => course.department],
                ["開課班級", course => course.className],
                ["授課教師", course => course.teacher],
                ["學分", course => course.credits + " 學分"],
                ["必選修", course => course.type],
                ["部別", course => course.program],
                ["上課時間", course => course.day + " " + course.period + " 節"],
                ["教室", course => course.classroom],
                ["開課人數", course => course.students + " 人"]
            ];

            let tableHTML = '<table class="course-table compare-table"><thead><tr><th>比較項目</th>';
            selectedCourses.forEach(course => {
                tableHTML += '<th>' + course.name + '</th>';
            });
            tableHTML += '</tr></thead><tbody>';

            comparisonRows.forEach(([label, getValue]) => {
                tableHTML += '<tr><th>' + label + '</th>';
                selectedCourses.forEach(course => {
                    tableHTML += '<td>' + getValue(course) + '</td>';
                });
                tableHTML += '</tr>';
            });

            tableHTML += '<tr><th>操作</th>';
            selectedCourses.forEach(course => {
                tableHTML += '<td><button type="button" class="small-button remove-compare-button" data-course-id="' +
                    course.id + '">移除此課程</button></td>';
            });
            tableHTML += '</tr></tbody></table>';

            compareCourseList.innerHTML = tableHTML;
        }

        // 勾選或取消勾選比較課程
        courseTableBody.addEventListener("change", function (event) {
            if (!event.target.classList.contains("compare-checkbox")) return;

            const courseId = Number(event.target.value);

            if (event.target.checked) {
                if (selectedCompareIds.size >= maxCompareCourses) {
                    event.target.checked = false;
                    alert("最多只能選擇三門課程進行比較。");
                    return;
                }
                selectedCompareIds.add(courseId);
            } else {
                selectedCompareIds.delete(courseId);
            }

            updateCompareCount();
        });

        // 開始比較
        if (startCompareButton) {
            startCompareButton.addEventListener("click", function () {
                if (selectedCompareIds.size === 0) {
                    alert("請先勾選至少一門課程，再開始比較。");
                    return;
                }

                renderCompareCourses();
                const compareMenu = document.querySelector(
                    '.menu-item[data-target="course-compare"]'
                );
                if (compareMenu) compareMenu.click();
            });
        }

        // 移除比較表中的單一課程
        if (compareCourseList) {
            compareCourseList.addEventListener("click", function (event) {
                const removeButton = event.target.closest(".remove-compare-button");
                if (!removeButton) return;

                selectedCompareIds.delete(Number(removeButton.dataset.courseId));
                renderCourses();
                renderCompareCourses();
            });
        }

        // 清空所有比較課程
        const clearCompareButton = document.getElementById("clearCompare");
        if (clearCompareButton) {
            clearCompareButton.addEventListener("click", function () {
                selectedCompareIds.clear();
                renderCourses();
                renderCompareCourses();
            });
        }

        // 從比較頁返回查詢頁
        const backToSearchButton = document.getElementById("backToSearch");
        if (backToSearchButton) {
            backToSearchButton.addEventListener("click", function () {
                const searchMenu = document.querySelector(
                    '.menu-item[data-target="course-search"]'
                );
                if (searchMenu) searchMenu.click();
            });
        }

        function searchCourses() {
            const semester = semesterSelect ? semesterSelect.value : "";
            const department = departmentSelect ? departmentSelect.value : "";
            const grade = gradeSelect ? gradeSelect.value : "";
            const type = typeSelect ? typeSelect.value : "";
            const program = programSelect ? programSelect.value : "";
            const day = daySelect ? daySelect.value : "";
            const keyword = keywordInput ? keywordInput.value.trim().toLowerCase() : "";

            filteredCourses = courses.filter(course => {
                return (!semester || course.semester === semester) &&
                    (!department || department === "全部系所" || course.department === department) &&
                    (!grade || grade === "全部年級" || course.grade === grade) &&
                    (!type || type === "全部" || course.type === type) &&
                    (!program || program === "全部" || course.program === program) &&
                    (!day || day === "全部星期" || course.day === day) &&
                    (!keyword || course.name.toLowerCase().includes(keyword) ||
                        course.teacher.toLowerCase().includes(keyword));
            });

            currentPage = 1;
            renderCourses();
        }

        const searchButton = document.getElementById("searchCourses");
        const clearButton = document.getElementById("clearSearch");

        if (searchButton) searchButton.addEventListener("click", searchCourses);

        if (clearButton) {
            clearButton.addEventListener("click", function () {
                if (semesterSelect) semesterSelect.value = "115-1";
                if (departmentSelect) departmentSelect.value = "全部系所";
                if (gradeSelect) gradeSelect.value = "全部年級";
                if (typeSelect) typeSelect.value = "全部";
                if (programSelect) programSelect.value = "全部";
                if (daySelect) daySelect.value = "全部星期";
                if (keywordInput) keywordInput.value = "";
                searchCourses();
            });
        }

        if (keywordInput) {
            keywordInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") searchCourses();
            });
        }

        if (prevPage) {
            prevPage.addEventListener("click", function () {
                if (currentPage > 1) {
                    currentPage--;
                    renderCourses();
                }
            });
        }

        if (nextPage) {
            nextPage.addEventListener("click", function () {
                const totalPages = Math.max(1, Math.ceil(filteredCourses.length / pageSize));
                if (currentPage < totalPages) {
                    currentPage++;
                    renderCourses();
                }
            });
        }

        
		/* ========================================
		   四、預選課模擬功能
		======================================== */

		// 儲存已加入預選的課程
		const selectedScheduleIds = new Set();

		// 取得預選課程頁面的 HTML 元素
		const selectedCourseTable = document.getElementById("selectedCourseTable");
		const selectedCourseCount = document.getElementById("selectedCourseCount");
		const totalCredits = document.getElementById("totalCredits");
		const conflictCount = document.getElementById("conflictCount");
		const weeklyScheduleBody = document.getElementById("weeklyScheduleBody");
		const clearScheduleButton = document.getElementById("clearSchedule");

		// 取得目前已預選的課程資料
		function getSelectedCourses() {
			return courses.filter(course =>
				selectedScheduleIds.has(course.id)
			);
		}

		// 取得課程的節次範圍
		function getCoursePeriods(course) {
			const periods = course.period.split("-").map(Number);

			if (periods.length !== 2) {
				return [];
			}

			const result = [];

			for (let i = periods[0]; i <= periods[1]; i++) {
				result.push(i);
			}

			return result;
		}

		// 檢查兩門課程是否衝堂
		function isCourseConflict(courseA, courseB) {

			if (courseA.day !== courseB.day) {
				return false;
			}

			const periodsA = getCoursePeriods(courseA);
			const periodsB = getCoursePeriods(courseB);

			return periodsA.some(period =>
				periodsB.includes(period)
			);
		}

		// 找出所有衝堂的課程 ID
		function getConflictCourseIds() {

			const selectedCourses = getSelectedCourses();
			const conflictIds = new Set();

			for (let i = 0; i < selectedCourses.length; i++) {

				for (let j = i + 1; j < selectedCourses.length; j++) {

					const courseA = selectedCourses[i];
					const courseB = selectedCourses[j];

					if (isCourseConflict(courseA, courseB)) {
						conflictIds.add(courseA.id);
						conflictIds.add(courseB.id);
					}
				}
			}

			return conflictIds;
		}

		// 更新預選課程統計資訊
		function updateScheduleSummary() {

			const selectedCourses = getSelectedCourses();

			const credits = selectedCourses.reduce(
				(total, course) => total + course.credits,
				0
			);

			const conflictIds = getConflictCourseIds();

			if (selectedCourseCount) {
				selectedCourseCount.textContent =
					selectedCourses.length + " 門";
			}

			if (totalCredits) {
				totalCredits.textContent = credits + " 學分";
			}

			if (conflictCount) {
				conflictCount.textContent =
					conflictIds.size + " 門";
				const card = conflictCount.closest(".summary-card");
				if (card) {
					card.classList.toggle("is-warning", conflictIds.size > 0);
				}
			}
		}

		// 顯示預選課程清單
		function renderSelectedCourses() {

			if (!selectedCourseTable) return;

			const selectedCourses = getSelectedCourses();
			const conflictIds = getConflictCourseIds();

			if (selectedCourses.length === 0) {

				selectedCourseTable.innerHTML = `
					<tr>
						<td colspan="7" class="empty-result">
							尚未加入任何預選課程
						</td>
					</tr>
				`;

				updateScheduleSummary();
				return;
			}

			selectedCourseTable.innerHTML = "";

			selectedCourses.forEach(course => {

				const isConflict = conflictIds.has(course.id);

				const row = document.createElement("tr");

				row.innerHTML = `
					<td>${course.name}</td>
					<td>${course.teacher}</td>
					<td>${course.credits}</td>
					<td>${course.day} ${course.period} 節</td>
					<td>${course.classroom}</td>
					<td>
						${isConflict
							? '<span class="status-badge is-conflict">發生衝堂</span>'
							: '<span class="status-badge is-ok">正常</span>'
						}
					</td>
					<td>
						<button
							type="button"
							class="small-button remove-schedule-button"
							data-course-id="${course.id}">
							移除
						</button>
					</td>
				`;

				selectedCourseTable.appendChild(row);
			});

			updateScheduleSummary();
		}

		// 產生每週課表
		function renderWeeklySchedule() {

			if (!weeklyScheduleBody) return;

			const selectedCourses = getSelectedCourses();
			const conflictIds = getConflictCourseIds();

			if (selectedCourses.length === 0) {

				weeklyScheduleBody.innerHTML = `
					<tr>
						<td colspan="6" class="empty-result">
							尚未加入課程，無法產生課表
						</td>
					</tr>
				`;

				return;
			}

			const weekdays = [
				"星期一",
				"星期二",
				"星期三",
				"星期四",
				"星期五"
			];

			weeklyScheduleBody.innerHTML = "";

			// 產生第 1 至第 6 節
			for (let period = 1; period <= 6; period++) {

				const row = document.createElement("tr");

				let rowHTML = `<td>第 ${period} 節</td>`;

				weekdays.forEach(day => {

					const matchedCourses = selectedCourses.filter(course => {

						return course.day === day &&
							getCoursePeriods(course).includes(period);

					});

					if (matchedCourses.length === 0) {

						rowHTML += "<td>－</td>";

					} else {

						const courseNames = matchedCourses.map(course => {

							const conflictText = conflictIds.has(course.id)
								? "（衝堂）"
								: "";

							return course.name + conflictText;

						});

						const hasConflict = matchedCourses.some(course =>
							conflictIds.has(course.id)
						);

						rowHTML += `
							<td>
								<span class="${hasConflict ? "schedule-cell-conflict" : "schedule-cell-ok"}">
									${courseNames.join("<br>")}
								</span>
							</td>
						`;
					}
				});

				row.innerHTML = rowHTML;
				weeklyScheduleBody.appendChild(row);
			}
		}

		// 更新整個預選課模擬頁面
		function renderSchedule() {

			renderSelectedCourses();
			renderWeeklySchedule();

			// 同步查詢頁面的預選按鈕狀態
			const addButtons = document.querySelectorAll(".add-course-button");

			addButtons.forEach(button => {

				const courseId = Number(button.dataset.courseId);

				if (selectedScheduleIds.has(courseId)) {
					button.textContent = "移除預選";
					button.disabled = false;
				} else {
					button.textContent = "加入預選";
					button.disabled = false;
				}

			});
		}

		// 在課程查詢頁直接加入或移除預選課程
		courseTableBody.addEventListener("click", function (event) {

			const addButton = event.target.closest(".add-course-button");

			if (!addButton) return;

			const courseId = Number(addButton.dataset.courseId);

			// 如果已經加入，則移除
			if (selectedScheduleIds.has(courseId)) {

				selectedScheduleIds.delete(courseId);

			} else {

				// 如果尚未加入，則新增
				selectedScheduleIds.add(courseId);

			}

			// 更新預選清單、學分統計及每週課表
			renderSchedule();

			// 更新課程查詢列表的按鈕文字
			renderCourses();

		});

		// 從預選清單移除單一課程
		if (selectedCourseTable) {

			selectedCourseTable.addEventListener("click", function (event) {

				const removeButton = event.target.closest(".remove-schedule-button");

				if (!removeButton) return;

				const courseId = Number(removeButton.dataset.courseId);

				selectedScheduleIds.delete(courseId);

				renderSchedule();
				renderCourses();
			});
		}

		// 清空所有預選課程
		if (clearScheduleButton) {

			clearScheduleButton.addEventListener("click", function () {

				if (selectedScheduleIds.size === 0) {
					alert("目前沒有預選課程。");
					return;
				}

				const confirmed = confirm("確定要清空所有預選課程嗎？");

				if (!confirmed) return;

				selectedScheduleIds.clear();

				renderSchedule();
				renderCourses();
			});
		}

		// 初次載入時顯示空的預選課模擬頁面
		renderSchedule();

		// 初次載入時，依照學期預設值顯示課程
		updateCompareCount();
		searchCourses();

    }
	
	
	/* ========================================
       五、個人帳號功能（僅學生端）
    ======================================== */

	const accountInfo = document.getElementById("accountInfo");
	const editAccountForm = document.getElementById("editAccountForm");
	const displayName = document.getElementById("displayName");
	const displayEmail = document.getElementById("displayEmail");
	const editName = document.getElementById("editName");
	const editEmail = document.getElementById("editEmail");
	const editAccountButton = document.getElementById("editAccount");
	const cancelEditButton = document.getElementById("cancelEdit");
	const changePasswordButton = document.getElementById("changePassword");
	const changePasswordForm = document.getElementById("changePasswordForm");
	const currentPassword = document.getElementById("currentPassword");
	const newPassword = document.getElementById("newPassword");
	const confirmPassword = document.getElementById("confirmPassword");
	const cancelPasswordButton = document.getElementById("cancelPassword");


	// 僅在學生端個人帳號頁元素存在時綁定（避免管理者頁中斷後續腳本）
	if (
		editAccountButton &&
		editAccountForm &&
		accountInfo &&
		changePasswordButton &&
		changePasswordForm &&
		cancelEditButton &&
		cancelPasswordButton
	) {

	// 點擊「修改個人資料」
	editAccountButton.addEventListener("click", function () {
		editName.value = displayName.textContent;
		editEmail.value = displayEmail.textContent;
		accountInfo.style.display = "none";
		editAccountForm.style.display = "block";
	});

	editAccountForm.addEventListener("submit", function (event) {
		event.preventDefault();
		const newName = editName.value.trim();
		const newEmail = editEmail.value.trim();
		if (newName === "" || newEmail === "") {
			alert("請完整填寫姓名及電子郵件！");
			return;
		}
		displayName.textContent = newName;
		displayEmail.textContent = newEmail;
		editAccountForm.style.display = "none";
		accountInfo.style.display = "block";
		alert("個人資料修改成功！");
	});

	cancelEditButton.addEventListener("click", function () {
		editAccountForm.style.display = "none";
		accountInfo.style.display = "block";
	});

	let demoPassword = "123456";

	changePasswordButton.addEventListener("click", function () {
		changePasswordForm.style.display = "block";
		currentPassword.value = "";
		newPassword.value = "";
		confirmPassword.value = "";
	});

	changePasswordForm.addEventListener("submit", function (event) {
		event.preventDefault();
		const oldPassword = currentPassword.value;
		const password = newPassword.value;
		const confirm = confirmPassword.value;
		if (oldPassword !== demoPassword) {
			alert("目前密碼輸入錯誤！");
			currentPassword.focus();
			return;
		}
		if (password.length < 6) {
			alert("新密碼至少需要 6 個字元！");
			newPassword.focus();
			return;
		}
		if (password === oldPassword) {
			alert("新密碼不可與目前密碼相同！");
			newPassword.focus();
			return;
		}
		if (password !== confirm) {
			alert("兩次輸入的新密碼不一致！");
			confirmPassword.focus();
			return;
		}
		demoPassword = password;
		changePasswordForm.reset();
		changePasswordForm.style.display = "none";
		alert("密碼變更成功！");
	});

	cancelPasswordButton.addEventListener("click", function () {
		changePasswordForm.reset();
		changePasswordForm.style.display = "none";
	});

	} // end student account guards


    /* ========================================
       管理者端功能
    ======================================== */

    if (document.body.classList.contains("admin-page")) {

        const pageTitles = {
            "course-manage": "課程管理",
            "course-import": "匯入課程",
            "account-manage": "帳號管理",
            "admin-account": "個人帳號"
        };

        const menuItems = document.querySelectorAll(".menu-item");
        const pageTitle = document.getElementById("pageTitle");
        const pageBreadcrumb = document.getElementById("pageBreadcrumb");
        const toastEl = document.getElementById("appToast");

        function showToast(message, type) {
            if (!toastEl) {
                alert(message);
                return;
            }
            toastEl.textContent = message;
            toastEl.className = "toast is-visible" + (type ? " is-" + type : "");
            clearTimeout(showToast._timer);
            showToast._timer = setTimeout(function () {
                toastEl.classList.remove("is-visible");
            }, 2600);
        }

        function switchPage(targetId) {
            document.querySelectorAll(".content-section").forEach(function (section) {
                section.classList.toggle("active", section.id === targetId);
            });
            menuItems.forEach(function (item) {
                item.classList.toggle("active", item.dataset.target === targetId);
            });
            if (pageTitle) pageTitle.textContent = pageTitles[targetId] || "";
            if (pageBreadcrumb) {
                pageBreadcrumb.textContent = "管理者端 / " + (pageTitles[targetId] || "");
            }
        }

        menuItems.forEach(function (item) {
            item.addEventListener("click", function () {
                switchPage(item.dataset.target);
            });
        });

        const savedAccount = sessionStorage.getItem("demoUserAccount");
        const adminDisplayName = document.getElementById("adminDisplayName");
        if (adminDisplayName && savedAccount) {
            adminDisplayName.textContent = savedAccount;
        }

        function openModal(id) {
            const el = document.getElementById(id);
            if (el) el.classList.add("is-open");
        }

        function closeModal(id) {
            const el = document.getElementById(id);
            if (el) el.classList.remove("is-open");
        }

        document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                closeModal(btn.getAttribute("data-close-modal"));
            });
        });

        document.querySelectorAll(".modal-overlay").forEach(function (overlay) {
            overlay.addEventListener("click", function (event) {
                if (event.target === overlay) {
                    overlay.classList.remove("is-open");
                }
            });
        });

        /* ----- 課程資料（示範） ----- */
        let adminCourses = [
            { id: 1, code: "IM2001", semester: "115-1", department: "資訊管理系", name: "資料庫管理", teacher: "王老師", className: "資管二A", credits: 3, type: "必修", day: "星期一", period: "3-4", classroom: "G202", students: 45, summary: "" },
            { id: 2, code: "IM2002", semester: "115-1", department: "資訊管理系", name: "網頁程式設計", teacher: "林老師", className: "資管二A", credits: 3, type: "必修", day: "星期二", period: "5-6", classroom: "F101", students: 40, summary: "" },
            { id: 3, code: "IM2003", semester: "115-1", department: "資訊管理系", name: "系統分析與設計", teacher: "陳老師", className: "資管二A", credits: 3, type: "必修", day: "星期三", period: "3-4", classroom: "G202", students: 42, summary: "" },
            { id: 4, code: "IM3010", semester: "115-1", department: "資訊管理系", name: "專題研究", teacher: "張老師", className: "資管三A", credits: 2, type: "選修", day: "星期四", period: "7-8", classroom: "G301", students: 25, summary: "" },
            { id: 5, code: "HM2101", semester: "115-1", department: "健康事業管理系", name: "健康資訊系統", teacher: "李老師", className: "健管二A", credits: 3, type: "必修", day: "星期五", period: "1-2", classroom: "B201", students: 38, summary: "" },
            { id: 6, code: "HM2205", semester: "115-1", department: "健康事業管理系", name: "醫療管理", teacher: "周老師", className: "健管二A", credits: 3, type: "選修", day: "星期一", period: "5-6", classroom: "B105", students: 35, summary: "" },
            { id: 7, code: "NS1001", semester: "115-1", department: "護理系", name: "基礎護理學", teacher: "許老師", className: "護理一A", credits: 3, type: "必修", day: "星期三", period: "1-2", classroom: "N201", students: 52, summary: "" },
            { id: 8, code: "IM3015", semester: "114-2", department: "資訊管理系", name: "使用者介面設計", teacher: "鄭老師", className: "資管三A", credits: 2, type: "選修", day: "星期四", period: "3-4", classroom: "F202", students: 30, summary: "" },
            { id: 9, code: "IM1501", semester: "114-2", department: "資訊管理系", name: "程式設計", teacher: "黃老師", className: "資管二B", credits: 3, type: "必修", day: "星期五", period: "1-2", classroom: "G101", students: 39, summary: "" },
            { id: 10, code: "HM3012", semester: "114-1", department: "健康事業管理系", name: "健康資料分析", teacher: "蔡老師", className: "健管三B", credits: 2, type: "選修", day: "星期一", period: "5-6", classroom: "B303", students: 28, summary: "" },
            { id: 11, code: "NS2003", semester: "114-1", department: "護理系", name: "成人護理學", teacher: "劉老師", className: "護理二A", credits: 3, type: "必修", day: "星期二", period: "1-2", classroom: "N202", students: 46, summary: "" }
        ];

        let nextCourseId = 12;
        let filteredAdminCourses = adminCourses.slice();
        let adminCoursePage = 1;
        const adminPageSize = 5;
        let pendingDeleteCourseId = null;

        const adminCourseTableBody = document.getElementById("adminCourseTableBody");
        const adminCourseCount = document.getElementById("adminCourseCount");
        const adminPaginationInfo = document.getElementById("adminPaginationInfo");
        const adminPageButtons = document.getElementById("adminPageButtons");

        function renderAdminCourses() {
            if (!adminCourseTableBody) return;
            const totalPages = Math.max(1, Math.ceil(filteredAdminCourses.length / adminPageSize));
            adminCoursePage = Math.min(adminCoursePage, totalPages);
            const start = (adminCoursePage - 1) * adminPageSize;
            const pageRows = filteredAdminCourses.slice(start, start + adminPageSize);

            if (pageRows.length === 0) {
                adminCourseTableBody.innerHTML =
                    '<tr><td colspan="9" class="empty-result">查無符合條件的課程</td></tr>';
            } else {
                adminCourseTableBody.innerHTML = pageRows.map(function (c) {
                    return (
                        "<tr>" +
                        "<td>" + c.code + "</td>" +
                        "<td>" + c.name + "</td>" +
                        "<td>" + c.className + "</td>" +
                        "<td>" + c.teacher + "</td>" +
                        "<td>" + c.credits + "</td>" +
                        "<td>" + c.type + "</td>" +
                        "<td>" + c.day.replace("星期", "") + " " + c.period + "</td>" +
                        "<td>" + c.classroom + "</td>" +
                        '<td>' +
                        '<button type="button" class="small-button edit-course-btn" data-id="' + c.id + '">修改</button> ' +
                        '<button type="button" class="small-button is-danger delete-course-btn" data-id="' + c.id + '">刪除</button>' +
                        "</td>" +
                        "</tr>"
                    );
                }).join("");
            }

            if (adminCourseCount) {
                adminCourseCount.textContent = "課程列表：共 " + filteredAdminCourses.length + " 筆";
            }
            if (adminPaginationInfo) {
                adminPaginationInfo.textContent = "第 " + adminCoursePage + " 頁 / 共 " + totalPages + " 頁";
            }

            const prev = document.getElementById("adminPrevPage");
            const next = document.getElementById("adminNextPage");
            if (prev) prev.disabled = adminCoursePage === 1;
            if (next) next.disabled = adminCoursePage === totalPages;

            if (adminPageButtons) {
                adminPageButtons.innerHTML = "";
                for (let page = 1; page <= totalPages; page++) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "page-number" + (page === adminCoursePage ? " active" : "");
                    button.textContent = String(page);
                    button.addEventListener("click", function () {
                        adminCoursePage = page;
                        renderAdminCourses();
                    });
                    adminPageButtons.appendChild(button);
                }
            }
        }

        function filterAdminCourses() {
            const semester = (document.getElementById("adminFilterSemester") || {}).value || "";
            const department = (document.getElementById("adminFilterDepartment") || {}).value || "";
            const type = (document.getElementById("adminFilterType") || {}).value || "";
            const keyword = ((document.getElementById("adminFilterKeyword") || {}).value || "").trim().toLowerCase();

            filteredAdminCourses = adminCourses.filter(function (c) {
                if (semester && c.semester !== semester) return false;
                if (department && c.department !== department) return false;
                if (type && c.type !== type) return false;
                if (keyword) {
                    const hay = (c.code + " " + c.name + " " + c.teacher).toLowerCase();
                    if (hay.indexOf(keyword) === -1) return false;
                }
                return true;
            });
            adminCoursePage = 1;
            renderAdminCourses();
        }

        const adminSearchBtn = document.getElementById("adminSearchCourses");
        if (adminSearchBtn) adminSearchBtn.addEventListener("click", filterAdminCourses);

        const adminClearBtn = document.getElementById("adminClearSearch");
        if (adminClearBtn) {
            adminClearBtn.addEventListener("click", function () {
                ["adminFilterSemester", "adminFilterDepartment", "adminFilterType", "adminFilterKeyword"].forEach(function (id) {
                    const el = document.getElementById(id);
                    if (el) el.value = "";
                });
                filterAdminCourses();
            });
        }

        const adminPrev = document.getElementById("adminPrevPage");
        const adminNext = document.getElementById("adminNextPage");
        if (adminPrev) {
            adminPrev.addEventListener("click", function () {
                if (adminCoursePage > 1) {
                    adminCoursePage -= 1;
                    renderAdminCourses();
                }
            });
        }
        if (adminNext) {
            adminNext.addEventListener("click", function () {
                const totalPages = Math.max(1, Math.ceil(filteredAdminCourses.length / adminPageSize));
                if (adminCoursePage < totalPages) {
                    adminCoursePage += 1;
                    renderAdminCourses();
                }
            });
        }

        function fillCourseForm(course) {
            document.getElementById("courseEditId").value = course ? String(course.id) : "";
            document.getElementById("courseCode").value = course ? course.code : "";
            document.getElementById("courseName").value = course ? course.name : "";
            document.getElementById("courseSemester").value = course ? course.semester : "115-1";
            document.getElementById("courseDepartment").value = course ? course.department : "資訊管理系";
            document.getElementById("courseClassName").value = course ? course.className : "";
            document.getElementById("courseTeacher").value = course ? course.teacher : "";
            document.getElementById("courseCredits").value = course ? course.credits : 3;
            document.getElementById("courseType").value = course ? course.type : "必修";
            document.getElementById("courseDay").value = course ? course.day : "星期一";
            document.getElementById("courseClassroom").value = course ? course.classroom : "";
            document.getElementById("courseStudents").value = course ? course.students : 40;
            document.getElementById("courseSummary").value = course ? (course.summary || "") : "";

            let start = 3;
            let end = 4;
            if (course && course.period) {
                const parts = String(course.period).split("-");
                start = parseInt(parts[0], 10) || 3;
                end = parseInt(parts[1] || parts[0], 10) || start;
            }
            document.getElementById("coursePeriodStart").value = String(start);
            document.getElementById("coursePeriodEnd").value = String(end);
        }

        const openAddCourse = document.getElementById("openAddCourse");
        if (openAddCourse) {
            openAddCourse.addEventListener("click", function () {
                document.getElementById("courseModalTitle").textContent = "新增課程";
                fillCourseForm(null);
                openModal("courseModal");
            });
        }

        if (adminCourseTableBody) {
            adminCourseTableBody.addEventListener("click", function (event) {
                const editBtn = event.target.closest(".edit-course-btn");
                const deleteBtn = event.target.closest(".delete-course-btn");
                if (editBtn) {
                    const id = Number(editBtn.dataset.id);
                    const course = adminCourses.find(function (c) { return c.id === id; });
                    if (!course) return;
                    document.getElementById("courseModalTitle").textContent = "修改課程";
                    fillCourseForm(course);
                    openModal("courseModal");
                }
                if (deleteBtn) {
                    const id = Number(deleteBtn.dataset.id);
                    const course = adminCourses.find(function (c) { return c.id === id; });
                    if (!course) return;
                    pendingDeleteCourseId = id;
                    document.getElementById("deleteCourseDetail").innerHTML =
                        "<strong>" + course.code + "　" + course.name + "</strong><br>開課班級：" + course.className;
                    openModal("deleteCourseModal");
                }
            });
        }

        const confirmDeleteCourse = document.getElementById("confirmDeleteCourse");
        if (confirmDeleteCourse) {
            confirmDeleteCourse.addEventListener("click", function () {
                if (pendingDeleteCourseId == null) return;
                adminCourses = adminCourses.filter(function (c) { return c.id !== pendingDeleteCourseId; });
                pendingDeleteCourseId = null;
                closeModal("deleteCourseModal");
                filterAdminCourses();
                showToast("課程已刪除", "success");
            });
        }

        const courseForm = document.getElementById("courseForm");
        if (courseForm) {
            courseForm.addEventListener("submit", function (event) {
                event.preventDefault();
                const start = parseInt(document.getElementById("coursePeriodStart").value, 10);
                const end = parseInt(document.getElementById("coursePeriodEnd").value, 10);
                if (end < start) {
                    showToast("結束節次不可小於起始節次", "error");
                    return;
                }
                const payload = {
                    code: document.getElementById("courseCode").value.trim(),
                    name: document.getElementById("courseName").value.trim(),
                    semester: document.getElementById("courseSemester").value,
                    department: document.getElementById("courseDepartment").value,
                    className: document.getElementById("courseClassName").value.trim(),
                    teacher: document.getElementById("courseTeacher").value.trim(),
                    credits: Number(document.getElementById("courseCredits").value),
                    type: document.getElementById("courseType").value,
                    day: document.getElementById("courseDay").value,
                    period: start + "-" + end,
                    classroom: document.getElementById("courseClassroom").value.trim(),
                    students: Number(document.getElementById("courseStudents").value) || 0,
                    summary: document.getElementById("courseSummary").value.trim()
                };
                const editId = document.getElementById("courseEditId").value;
                if (editId) {
                    const id = Number(editId);
                    adminCourses = adminCourses.map(function (c) {
                        return c.id === id ? Object.assign({}, c, payload) : c;
                    });
                    showToast("課程已更新", "success");
                } else {
                    payload.id = nextCourseId++;
                    adminCourses.unshift(payload);
                    showToast("課程已新增", "success");
                }
                closeModal("courseModal");
                filterAdminCourses();
            });
        }

        renderAdminCourses();

        /* ----- 匯入課程 ----- */
        let importPreviewRows = [];
        const importFile = document.getElementById("importFile");
        const importFileName = document.getElementById("importFileName");
        const importPreviewCard = document.getElementById("importPreviewCard");

        if (importFile) {
            importFile.addEventListener("change", function () {
                const file = importFile.files && importFile.files[0];
                if (importFileName) {
                    importFileName.textContent = file ? file.name : "尚未選擇檔案";
                }
            });
        }

        const downloadTemplate = document.getElementById("downloadTemplate");
        if (downloadTemplate) {
            downloadTemplate.addEventListener("click", function () {
                const header = "課號,課程名稱,開課系所,開課班級,授課教師,學分,必選修,星期,節次,教室,修課人數\n";
                const sample = "IM9999,示範課程,資訊管理系,資管二A,示範教師,3,選修,星期一,3-4,G999,30\n";
                const blob = new Blob(["\ufeff" + header + sample], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "課程匯入範本.csv";
                a.click();
                URL.revokeObjectURL(url);
                showToast("已下載範本檔", "success");
            });
        }

        function renderImportPreview() {
            const body = document.getElementById("importPreviewBody");
            if (!body) return;
            let ok = 0;
            let err = 0;
            body.innerHTML = importPreviewRows.map(function (row) {
                if (row.status === "error") err += 1;
                else ok += 1;
                const statusLabel = row.status === "error" ? "錯誤" : (row.status === "update" ? "更新" : "新增");
                const badge = row.status === "error"
                    ? '<span class="status-badge is-conflict">錯誤</span>'
                    : '<span class="status-badge is-ok">' + statusLabel + "</span>";
                return (
                    '<tr class="' + (row.status === "error" ? "row-error" : "") + '">' +
                    "<td>" + badge + "</td>" +
                    "<td>" + (row.code || "—") + "</td>" +
                    "<td>" + (row.name || "—") + "</td>" +
                    "<td>" + (row.teacher || "—") + "</td>" +
                    "<td>" + (row.credits != null ? row.credits : "—") + "</td>" +
                    "<td>" + (row.message || "") + "</td>" +
                    "</tr>"
                );
            }).join("");
            document.getElementById("importTotal").textContent = String(importPreviewRows.length);
            document.getElementById("importOk").textContent = String(ok);
            document.getElementById("importError").textContent = String(err);
        }

        const previewImport = document.getElementById("previewImport");
        if (previewImport) {
            previewImport.addEventListener("click", function () {
                const file = importFile && importFile.files && importFile.files[0];
                if (!file) {
                    showToast("請先選擇課程資料檔", "error");
                    return;
                }
                if (file.size > 5 * 1024 * 1024) {
                    showToast("檔案超過 5 MB 上限", "error");
                    return;
                }
                // 示範：不真正解析檔案，產生模擬預覽列
                const semester = document.getElementById("importSemester").value;
                importPreviewRows = [
                    { status: "new", code: "IM4101", name: "雲端運算導論", teacher: "吳老師", credits: 3, message: "將新增至 " + semester },
                    { status: "update", code: "IM2001", name: "資料庫管理", teacher: "王老師", credits: 3, message: "依課號更新現有資料" },
                    { status: "error", code: "", name: "缺課號課程", teacher: "未知", credits: 2, message: "課號為必填欄位" },
                    { status: "new", code: "NS1102", name: "護理倫理", teacher: "高老師", credits: 2, message: "將新增至 " + semester }
                ];
                renderImportPreview();
                if (importPreviewCard) importPreviewCard.hidden = false;
                showToast("已產生匯入預覽（示範資料）", "success");
            });
        }

        const cancelImport = document.getElementById("cancelImport");
        if (cancelImport) {
            cancelImport.addEventListener("click", function () {
                importPreviewRows = [];
                if (importPreviewCard) importPreviewCard.hidden = true;
            });
        }

        const confirmImport = document.getElementById("confirmImport");
        if (confirmImport) {
            confirmImport.addEventListener("click", function () {
                const mode = document.getElementById("importMode").value;
                const semester = document.getElementById("importSemester").value;
                const validRows = importPreviewRows.filter(function (r) { return r.status !== "error"; });
                if (validRows.length === 0) {
                    showToast("沒有可匯入的資料", "error");
                    return;
                }
                if (mode === "replace") {
                    adminCourses = adminCourses.filter(function (c) { return c.semester !== semester; });
                }
                validRows.forEach(function (row) {
                    const existing = adminCourses.find(function (c) { return c.code === row.code && c.semester === semester; });
                    if (existing) {
                        existing.name = row.name;
                        existing.teacher = row.teacher;
                        existing.credits = row.credits;
                    } else if (row.code) {
                        adminCourses.unshift({
                            id: nextCourseId++,
                            code: row.code,
                            semester: semester,
                            department: "資訊管理系",
                            name: row.name,
                            teacher: row.teacher,
                            className: "匯入班級",
                            credits: row.credits || 0,
                            type: "選修",
                            day: "星期一",
                            period: "1-2",
                            classroom: "TBD",
                            students: 0,
                            summary: "由匯入建立"
                        });
                    }
                });
                importPreviewRows = [];
                if (importPreviewCard) importPreviewCard.hidden = true;
                filterAdminCourses();
                showToast("匯入完成（示範）：成功 " + validRows.length + " 筆", "success");
            });
        }

        /* ----- 帳號管理 ----- */
        let users = [
            { id: 1, account: "00000001", name: "王小明", role: "student", department: "資訊管理系", email: "student@example.com", status: "active", lastLogin: "2026-11-26 14:20" },
            { id: 2, account: "00000002", name: "林小華", role: "student", department: "護理系", email: "lin@example.com", status: "active", lastLogin: "2026-11-25 09:10" },
            { id: 3, account: "00000003", name: "陳停用", role: "student", department: "健康事業管理系", email: "chen@example.com", status: "disabled", lastLogin: "2026-10-01 18:00" },
            { id: 4, account: "A0000001", name: "陳管理員", role: "admin", department: "教務處課務組", email: "admin@ntunhs.edu.tw", status: "active", lastLogin: "2026-11-27 08:00" },
            { id: 5, account: "A0000002", name: "李助理", role: "admin", department: "教務處", email: "lee@ntunhs.edu.tw", status: "active", lastLogin: "2026-11-20 11:30" },
            { id: 6, account: "00000004", name: "黃同學", role: "student", department: "資訊管理系", email: "huang@example.com", status: "active", lastLogin: "2026-11-18 16:45" }
        ];
        let nextUserId = 7;
        let filteredUsers = users.slice();
        let userPage = 1;
        const userPageSize = 5;

        const userTableBody = document.getElementById("userTableBody");

        function roleLabel(role) {
            return role === "admin" ? "管理者" : "學生";
        }

        function renderUsers() {
            if (!userTableBody) return;
            const totalPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
            userPage = Math.min(userPage, totalPages);
            const start = (userPage - 1) * userPageSize;
            const pageRows = filteredUsers.slice(start, start + userPageSize);

            if (pageRows.length === 0) {
                userTableBody.innerHTML =
                    '<tr><td colspan="8" class="empty-result">查無符合條件的帳號</td></tr>';
            } else {
                userTableBody.innerHTML = pageRows.map(function (u) {
                    const statusBadge = u.status === "active"
                        ? '<span class="status-badge is-ok">啟用</span>'
                        : '<span class="status-badge is-conflict">停用</span>';
                    const toggleLabel = u.status === "active" ? "停用" : "啟用";
                    return (
                        '<tr class="' + (u.status === "disabled" ? "row-disabled" : "") + '">' +
                        "<td>" + u.account + "</td>" +
                        "<td>" + u.name + "</td>" +
                        "<td>" + roleLabel(u.role) + "</td>" +
                        "<td>" + (u.department || "—") + "</td>" +
                        "<td>" + u.email + "</td>" +
                        "<td>" + statusBadge + "</td>" +
                        "<td>" + (u.lastLogin || "—") + "</td>" +
                        "<td>" +
                        '<button type="button" class="small-button edit-user-btn" data-id="' + u.id + '">修改</button> ' +
                        '<button type="button" class="small-button reset-pwd-btn" data-id="' + u.id + '">重設密碼</button> ' +
                        '<button type="button" class="small-button toggle-user-btn" data-id="' + u.id + '">' + toggleLabel + "</button>" +
                        "</td>" +
                        "</tr>"
                    );
                }).join("");
            }

            const countEl = document.getElementById("userAccountCount");
            if (countEl) countEl.textContent = "帳號列表：共 " + filteredUsers.length + " 筆";
            const info = document.getElementById("userPaginationInfo");
            if (info) info.textContent = "第 " + userPage + " 頁 / 共 " + totalPages + " 頁";

            const prev = document.getElementById("userPrevPage");
            const next = document.getElementById("userNextPage");
            if (prev) prev.disabled = userPage === 1;
            if (next) next.disabled = userPage === totalPages;

            const buttons = document.getElementById("userPageButtons");
            if (buttons) {
                buttons.innerHTML = "";
                for (let page = 1; page <= totalPages; page++) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "page-number" + (page === userPage ? " active" : "");
                    button.textContent = String(page);
                    button.addEventListener("click", function () {
                        userPage = page;
                        renderUsers();
                    });
                    buttons.appendChild(button);
                }
            }
        }

        function filterUsers() {
            const role = (document.getElementById("userFilterRole") || {}).value || "";
            const status = (document.getElementById("userFilterStatus") || {}).value || "";
            const keyword = ((document.getElementById("userFilterKeyword") || {}).value || "").trim().toLowerCase();
            filteredUsers = users.filter(function (u) {
                if (role && u.role !== role) return false;
                if (status && u.status !== status) return false;
                if (keyword) {
                    const hay = (u.account + " " + u.name + " " + u.email).toLowerCase();
                    if (hay.indexOf(keyword) === -1) return false;
                }
                return true;
            });
            userPage = 1;
            renderUsers();
        }

        const searchUsers = document.getElementById("searchUsers");
        if (searchUsers) searchUsers.addEventListener("click", filterUsers);
        const clearUserSearch = document.getElementById("clearUserSearch");
        if (clearUserSearch) {
            clearUserSearch.addEventListener("click", function () {
                ["userFilterRole", "userFilterStatus", "userFilterKeyword"].forEach(function (id) {
                    const el = document.getElementById(id);
                    if (el) el.value = "";
                });
                filterUsers();
            });
        }
        const userPrev = document.getElementById("userPrevPage");
        const userNext = document.getElementById("userNextPage");
        if (userPrev) {
            userPrev.addEventListener("click", function () {
                if (userPage > 1) {
                    userPage -= 1;
                    renderUsers();
                }
            });
        }
        if (userNext) {
            userNext.addEventListener("click", function () {
                const totalPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
                if (userPage < totalPages) {
                    userPage += 1;
                    renderUsers();
                }
            });
        }

        function fillUserForm(user) {
            document.getElementById("userEditId").value = user ? String(user.id) : "";
            document.getElementById("userAccount").value = user ? user.account : "";
            document.getElementById("userAccount").readOnly = !!user;
            document.getElementById("userName").value = user ? user.name : "";
            document.getElementById("userRole").value = user ? user.role : "student";
            document.getElementById("userDepartment").value = user ? (user.department || "") : "";
            document.getElementById("userEmail").value = user ? user.email : "";
            document.getElementById("userStatus").value = user ? user.status : "active";
            const pwdGroup = document.getElementById("userPasswordGroup");
            const pwd = document.getElementById("userPassword");
            if (user) {
                if (pwdGroup) pwdGroup.style.display = "none";
                if (pwd) {
                    pwd.required = false;
                    pwd.value = "";
                }
            } else {
                if (pwdGroup) pwdGroup.style.display = "";
                if (pwd) {
                    pwd.required = true;
                    pwd.value = "";
                }
            }
        }

        const openAddUser = document.getElementById("openAddUser");
        if (openAddUser) {
            openAddUser.addEventListener("click", function () {
                document.getElementById("userModalTitle").textContent = "新增帳號";
                fillUserForm(null);
                openModal("userModal");
            });
        }

        if (userTableBody) {
            userTableBody.addEventListener("click", function (event) {
                const editBtn = event.target.closest(".edit-user-btn");
                const resetBtn = event.target.closest(".reset-pwd-btn");
                const toggleBtn = event.target.closest(".toggle-user-btn");
                if (editBtn) {
                    const id = Number(editBtn.dataset.id);
                    const user = users.find(function (u) { return u.id === id; });
                    if (!user) return;
                    document.getElementById("userModalTitle").textContent = "修改帳號";
                    fillUserForm(user);
                    openModal("userModal");
                }
                if (resetBtn) {
                    const id = Number(resetBtn.dataset.id);
                    const user = users.find(function (u) { return u.id === id; });
                    if (!user) return;
                    showToast("已重設「" + user.name + "」的密碼為預設值（示範）", "success");
                }
                if (toggleBtn) {
                    const id = Number(toggleBtn.dataset.id);
                    users = users.map(function (u) {
                        if (u.id !== id) return u;
                        return Object.assign({}, u, {
                            status: u.status === "active" ? "disabled" : "active"
                        });
                    });
                    filterUsers();
                    showToast("帳號狀態已更新", "success");
                }
            });
        }

        const userForm = document.getElementById("userForm");
        if (userForm) {
            userForm.addEventListener("submit", function (event) {
                event.preventDefault();
                const editId = document.getElementById("userEditId").value;
                const account = document.getElementById("userAccount").value.trim();
                const name = document.getElementById("userName").value.trim();
                const role = document.getElementById("userRole").value;
                const department = document.getElementById("userDepartment").value.trim();
                const email = document.getElementById("userEmail").value.trim();
                const status = document.getElementById("userStatus").value;
                const password = document.getElementById("userPassword").value;

                if (!editId) {
                    if (users.some(function (u) { return u.account === account; })) {
                        showToast("帳號已存在", "error");
                        return;
                    }
                    if (!password || password.length < 8) {
                        showToast("初始密碼至少 8 碼", "error");
                        return;
                    }
                    users.unshift({
                        id: nextUserId++,
                        account: account,
                        name: name,
                        role: role,
                        department: department,
                        email: email,
                        status: status,
                        lastLogin: "—"
                    });
                    showToast("帳號已新增", "success");
                } else {
                    const id = Number(editId);
                    users = users.map(function (u) {
                        if (u.id !== id) return u;
                        return Object.assign({}, u, {
                            name: name,
                            role: role,
                            department: department,
                            email: email,
                            status: status
                        });
                    });
                    showToast("帳號已更新", "success");
                }
                closeModal("userModal");
                filterUsers();
            });
        }

        renderUsers();

        /* ----- 管理者個人帳號 ----- */
        let adminDemoPassword = "admin1234";
        const adminAccountInfo = document.getElementById("adminAccountInfo");
        const editAdminAccountForm = document.getElementById("editAdminAccountForm");
        const changeAdminPasswordForm = document.getElementById("changeAdminPasswordForm");

        const editAdminAccount = document.getElementById("editAdminAccount");
        if (editAdminAccount) {
            editAdminAccount.addEventListener("click", function () {
                document.getElementById("editAdminName").value = document.getElementById("adminName").textContent;
                document.getElementById("editAdminEmail").value = document.getElementById("adminEmail").textContent;
                if (adminAccountInfo) adminAccountInfo.style.display = "none";
                if (editAdminAccountForm) editAdminAccountForm.style.display = "block";
            });
        }

        const cancelEditAdmin = document.getElementById("cancelEditAdmin");
        if (cancelEditAdmin) {
            cancelEditAdmin.addEventListener("click", function () {
                if (editAdminAccountForm) editAdminAccountForm.style.display = "none";
                if (adminAccountInfo) adminAccountInfo.style.display = "block";
            });
        }

        if (editAdminAccountForm) {
            editAdminAccountForm.addEventListener("submit", function (event) {
                event.preventDefault();
                document.getElementById("adminName").textContent = document.getElementById("editAdminName").value.trim();
                document.getElementById("adminEmail").textContent = document.getElementById("editAdminEmail").value.trim();
                editAdminAccountForm.style.display = "none";
                if (adminAccountInfo) adminAccountInfo.style.display = "block";
                showToast("個人資料已更新", "success");
            });
        }

        const changeAdminPassword = document.getElementById("changeAdminPassword");
        if (changeAdminPassword) {
            changeAdminPassword.addEventListener("click", function () {
                if (changeAdminPasswordForm) changeAdminPasswordForm.style.display = "block";
            });
        }

        const cancelAdminPassword = document.getElementById("cancelAdminPassword");
        if (cancelAdminPassword) {
            cancelAdminPassword.addEventListener("click", function () {
                if (changeAdminPasswordForm) {
                    changeAdminPasswordForm.reset();
                    changeAdminPasswordForm.style.display = "none";
                }
            });
        }

        if (changeAdminPasswordForm) {
            changeAdminPasswordForm.addEventListener("submit", function (event) {
                event.preventDefault();
                const current = document.getElementById("adminCurrentPassword").value;
                const next = document.getElementById("adminNewPassword").value;
                const confirm = document.getElementById("adminConfirmPassword").value;
                if (current !== adminDemoPassword) {
                    showToast("目前密碼輸入錯誤", "error");
                    return;
                }
                if (next.length < 8) {
                    showToast("新密碼至少 8 碼", "error");
                    return;
                }
                if (next !== confirm) {
                    showToast("兩次新密碼不一致", "error");
                    return;
                }
                adminDemoPassword = next;
                changeAdminPasswordForm.reset();
                changeAdminPasswordForm.style.display = "none";
                showToast("密碼變更成功", "success");
            });
        }
    }

});
