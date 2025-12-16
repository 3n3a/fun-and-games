// Configuration for rows
const CATEGORIES = [
    { key: 'ones', label: 'Ones', icon: '⚀' },
    { key: 'twos', label: 'Twos', icon: '⚁' },
    { key: 'threes', label: 'Threes', icon: '⚂' },
    { key: 'fours', label: 'Fours', icon: '⚃' },
    { key: 'fives', label: 'Fives', icon: '⚄' },
    { key: 'sixes', label: 'Sixes', icon: '⚅' },
    { key: 'sum_upper', label: 'Sum Upper', type: 'calc' }, // Calculated
    { key: 'bonus', label: 'Bonus', type: 'calc' },         // Calculated
    { key: 'pair1', label: 'One Pair', icon: '⚀⚀' },
    { key: 'pair2', label: 'Two Pairs', icon: '⚀⚀ ⚁⚁' },
    { key: 'kind3', label: '3 of a Kind', icon: '⚀⚀⚀' },
    { key: 'kind4', label: '4 of a Kind', icon: '⚀⚀⚀⚀' },
    { key: 'small_straight', label: 'Small Str. (1-5)', icon: '⚀⚁⚂⚃⚄' },
    { key: 'large_straight', label: 'Large Str. (2-6)', icon: '⚁⚂⚃⚄⚅' },
    { key: 'full_house', label: 'Full House', icon: '⚀⚀⚀⚁⚁' },
    { key: 'chance', label: 'Chance', icon: '?' },
    { key: 'yatzy', label: 'Yatzy', icon: '⚅⚅⚅⚅⚅' },
    { key: 'total', label: 'TOTAL', type: 'calc' }           // Calculated
];

// App State
let state = {
    players: [],
    viewMode: 'icon' // 'icon' or 'text'
};

const STORAGE_KEY = 'yatzy_scoreboard_v1';

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    if (state.players.length === 0) {
        // Default: 2 players
        addPlayerToState('Player 1');
        addPlayerToState('Player 2');
    }
    renderTable();
    setupEventListeners();
});

// --- Core Logic ---

function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        state = JSON.parse(saved);
    }
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function addPlayerToState(name) {
    state.players.push({
        name: name,
        scores: {} // stores key: value (e.g., 'ones': 3)
    });
    saveState();
}

function updateScore(playerIndex, categoryKey, value) {
    const val = value === '' ? null : parseInt(value);
    state.players[playerIndex].scores[categoryKey] = val;
    calculateTotals(playerIndex);
    saveState();
    renderTable(); // Re-render to update calculated fields
}

function calculateTotals(playerIndex) {
    const player = state.players[playerIndex];
    const s = player.scores;

    // 1. Sum Upper
    const upperKeys = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
    let sumUpper = 0;
    upperKeys.forEach(k => {
        sumUpper += (s[k] || 0);
    });
    s['sum_upper'] = sumUpper;

    // 2. Bonus (Threshold 63, Reward 50)
    s['bonus'] = sumUpper >= 63 ? 50 : 0;

    // 3. Total (Sum Upper + Bonus + Lower Section)
    const lowerKeys = [
        'pair1', 'pair2', 'kind3', 'kind4', 
        'small_straight', 'large_straight', 'full_house', 
        'chance', 'yatzy'
    ];
    let lowerSum = 0;
    lowerKeys.forEach(k => {
        lowerSum += (s[k] || 0);
    });

    s['total'] = sumUpper + s['bonus'] + lowerSum;
}

// --- DOM Rendering ---

function renderTable() {
    const thead = document.getElementById('header-row');
    const tbody = document.getElementById('score-body');
    const btnText = document.getElementById('toggle-view-btn');

    // Update Button Text
    btnText.textContent = state.viewMode === 'icon' ? 'Switch to Text' : 'Switch to Icons';

    // 1. Render Header (Players)
    // Clear existing player headers (keep first 'Category' th)
    while (thead.children.length > 1) {
        thead.removeChild(thead.lastChild);
    }

    state.players.forEach(p => {
        const th = document.createElement('th');
        th.textContent = p.name;
        th.contentEditable = true; // Allow renaming
        th.onblur = (e) => {
            p.name = e.target.textContent;
            saveState();
        };
        thead.appendChild(th);
    });

    // 2. Render Body (Categories)
    tbody.innerHTML = '';

    CATEGORIES.forEach(cat => {
        const tr = document.createElement('tr');
        
        // Apply class for styling specific calculation rows
        if(cat.key === 'sum_upper') tr.className = 'row-sum';
        if(cat.key === 'bonus') tr.className = 'row-bonus';
        if(cat.key === 'total') tr.className = 'row-total';

        // Label Column
        const tdLabel = document.createElement('td');
        tdLabel.className = 'label-col';
        
        if (cat.type === 'calc') {
            tdLabel.textContent = cat.label;
        } else {
            if (state.viewMode === 'icon' && cat.icon) {
                tdLabel.innerHTML = `<span class="cat-icon">${cat.icon}</span>`;
            } else {
                tdLabel.innerHTML = `<span class="cat-text">${cat.label}</span>`;
            }
        }
        
        // Toggle view on click
        tdLabel.style.cursor = 'pointer';
        tdLabel.onclick = toggleViewMode;
        
        tr.appendChild(tdLabel);

        // Player Columns
        state.players.forEach((player, index) => {
            const td = document.createElement('td');
            const scoreVal = player.scores[cat.key] !== undefined && player.scores[cat.key] !== null ? player.scores[cat.key] : '';

            if (cat.type === 'calc') {
                // Read-only calculated field
                td.textContent = scoreVal;
            } else {
                // Input field
                const input = document.createElement('input');
                input.type = 'number';
                input.value = scoreVal;
                input.placeholder = '-';
                // Trigger update on change
                input.onchange = (e) => updateScore(index, cat.key, e.target.value);
                td.appendChild(input);
            }
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}

// --- Event Handlers ---

function setupEventListeners() {
    const dialog = document.getElementById('player-dialog');
    const addBtn = document.getElementById('add-player-btn');
    const confirmBtn = document.getElementById('confirm-add-player');
    const inputName = document.getElementById('new-player-name');
    const resetBtn = document.getElementById('reset-btn');
    const toggleBtn = document.getElementById('toggle-view-btn');

    // Dialog Logic
    addBtn.addEventListener('click', () => {
        inputName.value = '';
        dialog.showModal();
    });

    confirmBtn.addEventListener('click', (e) => {
        // Prevent form submission refreshing page
        if(inputName.value.trim()) {
            addPlayerToState(inputName.value.trim());
            renderTable();
        }
    });

    // Reset Logic
    resetBtn.addEventListener('click', () => {
        if(confirm("Are you sure you want to delete all scores and players?")) {
            localStorage.removeItem(STORAGE_KEY);
            state.players = [];
            state.scores = [];
            location.reload(); // Reload to restart fresh
        }
    });

    // Toggle View Logic
    toggleBtn.addEventListener('click', toggleViewMode);
}

function toggleViewMode() {
    state.viewMode = state.viewMode === 'icon' ? 'text' : 'icon';
    saveState();
    renderTable();
}
