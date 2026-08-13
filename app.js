/**
 * GradeBook Plus - 前端核心邏輯
 * 整合資料庫同步、Inline-Edit、成績登錄控制台、即時統計與 Chart.js 圖表分析
 * 欄位架構：10次平時考 (quiz_1 ~ quiz_10) 與學期平均 (average)
 * 支援雙班級切換：三年二班 (grades) 與三年三班 (grades2)
 */

// 後端 Google Apps Script Web App 部署網址
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbzQ0UTr3W59FuffqdWIc2DcJgUsVDm8i4NT2UQW8ZazUj0Q3IMXMIh_FJNaEu5ENfS2/exec";

// 三年二班 (grades) 固定基本名單
const STUDENT_NAMES = [
  "林宇軒", "陳雅婷", "張家豪", "李怡君", "王志明", "黃雅雯", "劉傑森", "蔡美玲", "吳俊宏", "賴淑芬",
  "謝冠宇", "周欣怡", "徐子晴", "曾聖凱", "詹凱婷", "梁品睿", "潘廷軒", "郭佳穎", "曹承翰", "許家瑜",
  "楊舒雅", "鄧宇翔", "彭若瑄", "蕭哲宇", "葉庭妤"
];

// 三年三班 (grades2) 固定基本名單
const STUDENT_NAMES_2 = [
  "王柏翰", "李冠廷", "林庭妤", "陳宇軒", "黃芷萱", "張家傑", "蔡睿軒", "許欣妤", "吳承恩", "賴宥廷",
  "謝羽婷", "洪子晴", "郭廷睿", "邱聖凱", "曾佳穎", "廖品睿", "柯亭軒", "潘怡君", "簡聖芬", "彭承翰",
  "游家瑜", "詹舒雅", "盧宇翔", "蕭若瑄", "葉哲宇"
];

// 全域變數
let studentGrades = [];
let currentClass = "grades"; // 當前選擇的班級，預設為 "grades" (三年二班)
let currentSortField = "seat_id";
let currentSortOrder = "asc"; // "asc" | "desc"
let subjectAvgChart = null;
let scoreDistChart = null;

const QUIZ_FIELDS = [
  "quiz_1", "quiz_2", "quiz_3", "quiz_4", "quiz_5",
  "quiz_6", "quiz_7", "quiz_8", "quiz_9", "quiz_10"
];

const QUIZ_LABELS = [
  "平時考 1", "平時考 2", "平時考 3", "平時考 4", "平時考 5",
  "平時考 6", "平時考 7", "平時考 8", "平時考 9", "平時考 10"
];

// 初始化應用程式
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

async function initApp() {
  showLoading("正在偵測伺服器連線狀態...");
  
  // 1. 初始化學生成績登錄控制台下拉選單
  initStudentSelect();
  
  // 2. 綁定控制按鈕
  document.getElementById("reload-btn").addEventListener("click", () => loadDataFromServer(true));
  document.getElementById("save-btn").addEventListener("click", saveDataToServer);
  document.getElementById("search-input").addEventListener("input", filterTable);
  
  // 3. 綁定控制台表單事件
  document.getElementById("quick-entry-form").addEventListener("submit", handleQuickEntrySubmit);
  document.getElementById("clear-entry-btn").addEventListener("click", clearQuickEntryForm);
  document.getElementById("student-select").addEventListener("change", handleStudentSelectChange);
  
  // 4. 綁定班級切換 Tab 事件
  initClassSwitcher();
  
  // 5. 綁定表頭排序
  const headers = document.querySelectorAll(".grades-table th.sortable");
  headers.forEach(header => {
    header.addEventListener("click", () => {
      const field = header.getAttribute("data-sort");
      handleSort(field);
    });
  });

  // 嘗試載入資料
  await loadDataFromServer(false);
  hideLoading();
}

/**
 * 綁定頂部班級切換 Tab 鍵事件
 */
function initClassSwitcher() {
  const tabs = document.querySelectorAll(".class-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("active")) return;
      
      // 切換 active 類別
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      
      // 變更當前工作表 class 路由
      currentClass = tab.getAttribute("data-class");
      
      // 更新標籤文字
      const labelMap = { grades: "三年二班", grades2: "三年三班" };
      document.getElementById("current-class-label").textContent = labelMap[currentClass];
      
      // 重新從伺服器拉取該班級的資料
      loadDataFromServer(true);
    });
  });
}

/**
 * 初始化登錄控制台的學生下拉選單 (根據當前班級動態決定學生姓名)
 */
function initStudentSelect() {
  const select = document.getElementById("student-select");
  select.innerHTML = "";
  
  const names = (currentClass === "grades2") ? STUDENT_NAMES_2 : STUDENT_NAMES;
  
  for (let i = 1; i <= 25; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `座號 ${String(i).padStart(2, '0')} - ${names[i - 1]}`;
    select.appendChild(opt);
  }
}

/**
 * 載入資料：優先向 Google Sheets 讀取，失敗則使用本地空白資料
 */
async function loadDataFromServer(isManualReload = false) {
  if (isManualReload) {
    showLoading(`正在同步雲端資料...`);
  }
  
  const statusBadge = document.getElementById("api-status");
  const sheetLink = document.getElementById("sheet-link");
  
  try {
    if (!GAS_API_URL || GAS_API_URL.includes("YOUR_GAS_API_URL_HERE")) {
      throw new Error("API 網址未設定，改用本地端離線演示。");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    // 帶入 class 參數來指定對接的工作表
    const response = await fetch(`${GAS_API_URL}?action=getGrades&class=${currentClass}`, {
      method: "GET",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`伺服器回應錯誤: ${response.status}`);
    }
    
    const result = await response.json();
    if (result.status === "success" && Array.isArray(result.data) && result.data.length === 25) {
      studentGrades = result.data;
      
      statusBadge.className = "api-status-badge online";
      statusBadge.querySelector(".status-text").textContent = "雲端同步中";
      
      if (result.spreadsheetUrl) {
        sheetLink.href = result.spreadsheetUrl;
        sheetLink.style.display = "inline-flex";
      }
      
      if (isManualReload) {
        const labelMap = { grades: "三年二班", grades2: "三年三班" };
        showToast("同步成功", `已完成【${labelMap[currentClass]}】雲端資料同步。`, "success");
      }
    } else {
      throw new Error("伺服器資料異常或未初始化");
    }
  } catch (error) {
    console.warn("後端連線失敗，已自動啟用本地離線空白資料。", error);
    
    statusBadge.className = "api-status-badge local";
    statusBadge.querySelector(".status-text").textContent = "本地演示模式";
    sheetLink.style.display = "none";
    
    generateLocalBlankGrades();
    
    if (isManualReload) {
      showToast("本地資料重置", "後端連線失敗，已重置本地空白成績。", "warning");
    }
  } finally {
    if (isManualReload) {
      hideLoading();
    }
    
    // 依據新班級名單重新生成選單與表格，重算統計
    initStudentSelect();
    refreshUI();
    loadActiveStudentToForm();
  }
}

/**
 * 產生當前班級的本地空白成績
 */
function generateLocalBlankGrades() {
  studentGrades = [];
  const names = (currentClass === "grades2") ? STUDENT_NAMES_2 : STUDENT_NAMES;
  
  for (let i = 1; i <= 25; i++) {
    const student = {
      seat_id: i,
      name: names[i - 1],
      average: "",
      comment: ""
    };
    QUIZ_FIELDS.forEach(f => student[f] = "");
    studentGrades.push(student);
  }
}

/**
 * 計算統計數據並更新指標卡與圖表
 */
function refreshUI() {
  // 1. 重新計算學期平均
  recalculateGrades();
  
  // 2. 計算班級統計
  let sumAverage = 0;
  let gradedCount = 0;
  let passCount = 0;
  let excelCount = 0;
  let failCount = 0;
  
  studentGrades.forEach(student => {
    if (student.average !== "" && student.average !== null && student.average !== undefined) {
      const avg = Number(student.average);
      sumAverage += avg;
      gradedCount++;
      
      if (avg >= 60) {
        passCount++;
      } else {
        failCount++;
      }
      
      if (avg >= 90) {
        excelCount++;
      }
    }
  });
  
  // 3. 更新 Metrics DOM
  if (gradedCount > 0) {
    const classAvg = Math.round((sumAverage / gradedCount) * 10) / 10;
    const passRate = Math.round((passCount / gradedCount) * 100);
    
    document.getElementById("class-avg").textContent = classAvg.toFixed(1);
    document.getElementById("pass-rate").textContent = `${passRate}%`;
    document.getElementById("excel-count").textContent = excelCount;
    document.getElementById("fail-count").textContent = failCount;
  } else {
    document.getElementById("class-avg").textContent = "-";
    document.getElementById("pass-rate").textContent = "0%";
    document.getElementById("excel-count").textContent = "0";
    document.getElementById("fail-count").textContent = "0";
  }
  
  // 4. 排序並重新渲染表格
  sortGrades();
  renderTable();
  
  // 5. 重新繪製 Chart.js
  updateCharts();
}

/**
 * 遍歷學生成績，依據已登錄的平時考動態計算平均
 */
function recalculateGrades() {
  studentGrades.forEach(student => {
    const isBlank = (v) => v === "" || v === null || v === undefined;
    const scoredQuizzes = QUIZ_FIELDS.filter(f => !isBlank(student[f]));
    
    if (scoredQuizzes.length > 0) {
      const sum = scoredQuizzes.reduce((acc, curr) => acc + Number(student[curr]), 0);
      student.average = Math.round((sum / scoredQuizzes.length) * 10) / 10;
    } else {
      student.average = "";
    }
  });
}

/**
 * 渲染成績表格
 */
function renderTable() {
  const tbody = document.getElementById("table-body");
  tbody.innerHTML = "";
  
  studentGrades.forEach(student => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-seat", student.seat_id);
    
    tr.addEventListener("click", (e) => {
      if (e.target.tagName === "INPUT") return;
      
      const select = document.getElementById("student-select");
      select.value = student.seat_id;
      loadActiveStudentToForm();
      
      document.querySelectorAll("#table-body tr").forEach(r => r.style.backgroundColor = "");
      tr.style.backgroundColor = "rgba(0, 204, 255, 0.08)";
    });
    
    const createCell = (field, isEditable = true, isNumeric = true) => {
      const td = document.createElement("td");
      const value = student[field];
      td.setAttribute("data-field", field);
      
      const isBlankVal = value === "" || value === null || value === undefined;
      
      if (isBlankVal) {
        td.textContent = (field === "average") ? "-" : "";
        if (field !== "comment") {
          td.classList.add("score-empty");
        }
      } else {
        td.textContent = value;
      }
      
      if (isEditable) {
        td.classList.add("editable");
        
        if (isNumeric && !isBlankVal) {
          const numVal = Number(value);
          if (numVal < 60) {
            td.className = "editable score-fail";
          } else if (numVal >= 90) {
            td.className = "editable score-excellent";
          } else {
            td.className = "editable score-pass";
          }
        }
      } else {
        if (field === "average") {
          td.className = "cell-average";
          if (!isBlankVal) {
            const avgVal = Number(value);
            if (avgVal < 60) td.classList.add("score-fail");
            else if (avgVal >= 90) td.classList.add("score-excellent");
          }
        }
      }
      
      if (isEditable) {
        td.addEventListener("dblclick", () => startEditing(td, student.seat_id, field, isNumeric));
      }
      
      return td;
    };

    tr.appendChild(createCell("seat_id", false));
    tr.appendChild(createCell("name", false)); 
    
    QUIZ_FIELDS.forEach(f => {
      tr.appendChild(createCell(f));
    });
    
    tr.appendChild(createCell("average", false, true));
    tr.appendChild(createCell("comment", true, false));
    
    tbody.appendChild(tr);
  });
  
  filterTable();
}

/**
 * 進入儲存格編輯狀態 (Inline Edit)
 */
function startEditing(td, seatId, field, isNumeric) {
  if (td.querySelector("input")) return;
  
  const originalValue = td.textContent === "-" ? "" : td.textContent;
  td.innerHTML = "";
  
  const input = document.createElement("input");
  input.value = originalValue;
  
  if (isNumeric) {
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.className = "edit-input";
  } else {
    input.type = "text";
    input.className = "edit-input-comment";
  }
  
  td.appendChild(input);
  input.focus();
  input.select();
  
  const saveEdit = () => {
    let newValue = input.value.trim();
    
    if (isNumeric) {
      if (newValue === "") {
        newValue = "";
      } else {
        let num = parseInt(newValue, 10);
        if (isNaN(num) || num < 0 || num > 100) {
          showToast("輸入錯誤", "分數必須介於 0 至 100 之間！", "error");
          td.textContent = originalValue;
          if (originalValue === "") td.classList.add("score-empty");
          else applyCellColor(td, originalValue);
          return;
        }
        newValue = num;
      }
    }
    
    const student = studentGrades.find(s => s.seat_id === seatId);
    if (student) {
      student[field] = newValue;
    }
    
    refreshUI();
    loadActiveStudentToForm(); 
    showToast("分數已暫存", `座號 ${seatId} 的 ${getFieldCNName(field)} 已修改。別忘了儲存至雲端！`, "info");
  };
  
  input.addEventListener("blur", saveEdit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      input.blur();
    } else if (e.key === "Escape") {
      input.removeEventListener("blur", saveEdit);
      td.textContent = originalValue;
      if (originalValue === "") td.classList.add("score-empty");
      else applyCellColor(td, originalValue);
    }
  });
}

function applyCellColor(td, val) {
  const numVal = Number(val);
  td.className = "editable";
  if (val === "" || val === null || val === undefined) {
    td.classList.add("score-empty");
  } else if (numVal < 60) {
    td.classList.add("score-fail");
  } else if (numVal >= 90) {
    td.classList.add("score-excellent");
  } else {
    td.classList.add("score-pass");
  }
}

function getFieldCNName(field) {
  if (field.startsWith("quiz_")) {
    const idx = field.split("_")[1];
    return `平時考 ${idx}`;
  }
  const map = {
    average: "學期平均", comment: "綜合評語"
  };
  return map[field] || field;
}

/**
 * 排序邏輯
 */
function handleSort(field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
  } else {
    currentSortField = field;
    currentSortOrder = "asc";
  }
  
  const headers = document.querySelectorAll(".grades-table th");
  headers.forEach(h => {
    const icon = h.querySelector("i");
    if (icon) {
      if (h.getAttribute("data-sort") === field) {
        icon.className = currentSortOrder === "asc" ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
        h.style.color = "var(--color-primary)";
      } else {
        icon.className = "fa-solid fa-sort";
        h.style.color = "";
      }
    }
  });
  
  refreshUI();
}

function sortGrades() {
  studentGrades.sort((a, b) => {
    let valA = a[currentSortField];
    let valB = b[currentSortField];
    
    const isAEmpty = valA === "" || valA === null || valA === undefined;
    const isBEmpty = valB === "" || valB === null || valB === undefined;
    
    if (isAEmpty && !isBEmpty) return 1;
    if (!isAEmpty && isBEmpty) return -1;
    if (isAEmpty && isBEmpty) return 0;
    
    if (typeof valA === "number" && typeof valB === "number") {
      return currentSortOrder === "asc" ? valA - valB : valB - valA;
    }
    
    valA = String(valA);
    valB = String(valB);
    return currentSortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
  });
}

/**
 * 搜尋與過濾
 */
function filterTable() {
  const searchVal = document.getElementById("search-input").value.trim().toLowerCase();
  const rows = document.querySelectorAll("#table-body tr");
  
  rows.forEach(row => {
    const seatId = row.querySelector("td[data-field='seat_id']").textContent;
    const name = row.querySelector("td:nth-child(2)").textContent.toLowerCase();
    
    if (seatId.includes(searchVal) || name.includes(searchVal)) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  });
}

/**
 * ==========================================
 * 成績登錄控制台 (Quick Entry Console) 邏輯
 * ==========================================
 */

/**
 * 下拉選單變更事件
 */
function handleStudentSelectChange() {
  loadActiveStudentToForm();
  
  const seatId = Number(document.getElementById("student-select").value);
  document.querySelectorAll("#table-body tr").forEach(tr => {
    tr.style.backgroundColor = "";
    if (Number(tr.getAttribute("data-seat")) === seatId) {
      tr.style.backgroundColor = "rgba(0, 204, 255, 0.08)";
      tr.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

/**
 * 將目前下拉選單選取的學生成績載入至輸入表單中
 */
function loadActiveStudentToForm() {
  const seatId = Number(document.getElementById("student-select").value);
  const student = studentGrades.find(s => s.seat_id === seatId);
  
  if (!student) return;
  
  QUIZ_FIELDS.forEach(f => {
    document.getElementById(`input-${f}`).value = student[f];
  });
  
  document.getElementById("input-comment").value = student.comment || "";
}

/**
 * 清空當前選取學生的輸入表單 (清空為未登錄狀態)
 */
function clearQuickEntryForm() {
  QUIZ_FIELDS.forEach(f => {
    document.getElementById(`input-${f}`).value = "";
  });
  document.getElementById("input-comment").value = "";
}

/**
 * 處理登錄表單的送出確認
 */
function handleQuickEntrySubmit(e) {
  e.preventDefault();
  
  const seatId = Number(document.getElementById("student-select").value);
  const student = studentGrades.find(s => s.seat_id === seatId);
  
  if (!student) return;
  
  const updatedGrades = {};
  
  // 1. 驗證並收集輸入資料
  for (let i = 0; i < QUIZ_FIELDS.length; i++) {
    const f = QUIZ_FIELDS[i];
    const val = document.getElementById(`input-${f}`).value.trim();
    
    if (val === "") {
      updatedGrades[f] = "";
    } else {
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 0 || num > 100) {
        showToast("登錄失敗", `${getFieldCNName(f)}成績必須是 0-100 之間的整數！`, "error");
        document.getElementById(`input-${f}`).focus();
        return;
      }
      updatedGrades[f] = num;
    }
  }
  
  const comment = document.getElementById("input-comment").value.trim();
  
  // 2. 寫入記憶體結構
  QUIZ_FIELDS.forEach(f => {
    student[f] = updatedGrades[f];
  });
  student.comment = comment;
  
  // 3. 重新整理 UI
  refreshUI();
  showToast("登錄成功", `座號 ${seatId} (${student.name}) 的成績已成功暫存！`, "success");
  
  // 4. 自動跳轉至下一位學生
  const select = document.getElementById("student-select");
  if (seatId < 25) {
    select.value = seatId + 1;
    handleStudentSelectChange();
    
    document.getElementById("input-quiz_1").focus();
    document.getElementById("input-quiz_1").select();
  }
}

/**
 * 儲存資料至 Google Sheet (POST API)
 */
async function saveDataToServer() {
  const labelMap = { grades: "三年二班", grades2: "三年三班" };
  showLoading(`正在同步【${labelMap[currentClass]}】資料至 Google Sheets...`);
  
  try {
    if (!GAS_API_URL || GAS_API_URL.includes("YOUR_GAS_API_URL_HERE")) {
      throw new Error("尚未設定 Google Apps Script Web App 連結。");
    }

    const payload = {
      action: "updateGrades",
      class: currentClass, // 傳入當前班級參數以動態決定寫入的工作表
      grades: studentGrades
    };
    
    const response = await fetch(GAS_API_URL, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (result.status === "success") {
      showToast("儲存成功", `【${labelMap[currentClass]}】的所有學生成績已同步儲存！`, "success");
      
      const statusBadge = document.getElementById("api-status");
      statusBadge.className = "api-status-badge online";
      statusBadge.querySelector(".status-text").textContent = "雲端同步中";
      
      if (result.spreadsheetUrl) {
        const sheetLink = document.getElementById("sheet-link");
        sheetLink.href = result.spreadsheetUrl;
        sheetLink.style.display = "inline-flex";
      }
    } else {
      throw new Error(result.message || "更新失敗");
    }
  } catch (error) {
    console.error("寫入雲端失敗：", error);
    showToast("儲存失敗", "無法連結雲端，成績已暫存於瀏覽器中，請稍後再試。", "error");
  } finally {
    hideLoading();
  }
}

/**
 * Chart.js 圖表更新邏輯
 */
function updateCharts() {
  const subjectAverages = QUIZ_FIELDS.map(f => {
    let sum = 0;
    let count = 0;
    studentGrades.forEach(st => {
      if (st[f] !== "" && st[f] !== null && st[f] !== undefined) {
        sum += Number(st[f]);
        count++;
      }
    });
    return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
  });
  
  const distCounts = [0, 0, 0, 0, 0]; 
  
  studentGrades.forEach(st => {
    if (st.average !== "" && st.average !== null && st.average !== undefined) {
      const avg = st.average;
      if (avg >= 90) distCounts[0]++;
      else if (avg >= 80) distCounts[1]++;
      else if (avg >= 70) distCounts[2]++;
      else if (avg >= 60) distCounts[3]++;
      else distCounts[4]++;
    }
  });

  // --- 圖表 1: 10次平時考班級平均條狀圖 ---
  if (subjectAvgChart) {
    subjectAvgChart.data.datasets[0].data = subjectAverages;
    subjectAvgChart.update();
  } else {
    const ctx = document.getElementById("subjectAvgChart").getContext("2d");
    subjectAvgChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: QUIZ_LABELS,
        datasets: [{
          label: "班級平時考平均分數",
          data: subjectAverages,
          backgroundColor: "rgba(0, 204, 255, 0.4)",
          borderColor: "rgba(0, 204, 255, 1)",
          borderWidth: 1.5,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "各次平時考班級平均分 (排除空白成績)",
            color: "#f3f4f6",
            font: { size: 14, family: "'Outfit', 'Noto Sans TC'" }
          }
        },
        scales: {
          y: {
            min: 0,
            max: 100,
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "#9ca3af" }
          },
          x: {
            grid: { display: false },
            ticks: { color: "#9ca3af" }
          }
        }
      }
    });
  }

  // --- 圖表 2: 學期平均成績區間人數橫條圖 ---
  if (scoreDistChart) {
    scoreDistChart.data.datasets[0].data = distCounts;
    scoreDistChart.update();
  } else {
    const ctx = document.getElementById("scoreDistChart").getContext("2d");
    scoreDistChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["優秀 (90+分)", "優良 (80-89分)", "中等 (70-79分)", "及格 (60-69分)", "不及格 (<60分)"],
        datasets: [{
          label: "人數 (人)",
          data: distCounts,
          backgroundColor: [
            "rgba(255, 204, 0, 0.5)",   
            "rgba(51, 204, 255, 0.5)",  
            "rgba(168, 85, 247, 0.5)",  
            "rgba(34, 197, 94, 0.5)",   
            "rgba(239, 68, 68, 0.5)"    
          ],
          borderColor: [
            "rgba(255, 204, 0, 1)",
            "rgba(51, 204, 255, 1)",
            "rgba(168, 85, 247, 1)",
            "rgba(34, 197, 94, 1)",
            "rgba(239, 68, 68, 1)"
          ],
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "全班學期平均成績人數分佈",
            color: "#f3f4f6",
            font: { size: 14, family: "'Outfit', 'Noto Sans TC'" }
          }
        },
        scales: {
          x: {
            ticks: { stepSize: 1, color: "#9ca3af" },
            grid: { color: "rgba(255, 255, 255, 0.05)" }
          },
          y: {
            grid: { display: false },
            ticks: { color: "#9ca3af" }
          }
        }
      }
    });
  }
}

/**
 * 輔助 UI: 顯示/隱藏 Loading
 */
function showLoading(text) {
  const loader = document.getElementById("loading-overlay");
  const loaderText = document.getElementById("loading-text");
  if (loaderText) loaderText.textContent = text;
  if (loader) loader.classList.add("show");
}

function hideLoading() {
  const loader = document.getElementById("loading-overlay");
  if (loader) loader.classList.remove("show");
}

/**
 * 輔助 UI: 輕量 Toast 訊息通知
 */
function showToast(title, message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let iconClass = "fa-circle-info";
  if (type === "success") iconClass = "fa-circle-check";
  if (type === "error") iconClass = "fa-circle-exclamation";
  if (type === "warning") iconClass = "fa-triangle-exclamation";
  
  toast.innerHTML = `
    <i class="fa-solid ${iconClass}"></i>
    <div>
      <strong style="display:block;font-size:0.9rem;">${title}</strong>
      <span style="font-size:0.8rem;opacity:0.85;">${message}</span>
    </div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => toast.classList.add("show"), 10);
  
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}
