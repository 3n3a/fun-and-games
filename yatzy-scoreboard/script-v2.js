// Validation ranges for each category
const VALIDATION_RANGES = {
    'ones': { min: 0, max: 5, step: 1 },
    'twos': { min: 0, max: 10, step: 2 },
    'threes': { min: 0, max: 18, step: 3 }, // User requested 0-18
    'fours': { min: 0, max: 20, step: 4 },
    'fives': { min: 0, max: 25, step: 5 },
    'sixes': { min: 0, max: 30, step: 6 },
    'pair1': { min: 0, max: 12, step: 2 },
    'pair2': { min: 0, max: 22, step: 2 },
    'kind3': { min: 0, max: 18, step: 3 },
    'kind4': { min: 0, max: 24, step: 4 },
    'small_straight': { min: 0, max: 15, step: 15 }, // Usually fixed 15
    'large_straight': { min: 0, max: 20, step: 20 }, // Usually fixed 20
    'full_house': { min: 0, max: 28, step: 1 },
    'chance': { min: 0, max: 30, step: 1 },
    'yatzy': { min: 0, max: 50, step: 50 }
};

// Configuration for rows
const APP_VERSION = 'v2.0';

const CATEGORIES = [
    { key: 'ones', label: 'Ones', icon: '<i class="fas fa-dice-one"></i>' },
    { key: 'twos', label: 'Twos', icon: '<i class="fas fa-dice-two"></i>' },
    { key: 'threes', label: 'Threes', icon: '<i class="fas fa-dice-three"></i>' },
    { key: 'fours', label: 'Fours', icon: '<i class="fas fa-dice-four"></i>' },
    { key: 'fives', label: 'Fives', icon: '<i class="fas fa-dice-five"></i>' },
    { key: 'sixes', label: 'Sixes', icon: '<i class="fas fa-dice-six"></i>' },
    { key: 'sum_upper', label: 'Sum Upper', type: 'calc' }, // Calculated
    { key: 'bonus', label: 'Bonus', type: 'calc' },         // Calculated
    { key: 'pair1', label: 'One Pair', icon: '<i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i>' },
    { key: 'pair2', label: 'Two Pairs', icon: '<i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i> <i class="fas fa-dice-two"></i><i class="fas fa-dice-two"></i>' },
    { key: 'kind3', label: '3 of a Kind', icon: '<i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i>' },
    { key: 'kind4', label: '4 of a Kind', icon: '<i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i>' },
    { key: 'small_straight', label: 'Small Str. (1-5)', icon: '<i class="fas fa-dice-one"></i><i class="fas fa-dice-two"></i><i class="fas fa-dice-three"></i><i class="fas fa-dice-four"></i><i class="fas fa-dice-five"></i>' },
    { key: 'large_straight', label: 'Large Str. (2-6)', icon: '<i class="fas fa-dice-two"></i><i class="fas fa-dice-three"></i><i class="fas fa-dice-four"></i><i class="fas fa-dice-five"></i><i class="fas fa-dice-six"></i>' },
    { key: 'full_house', label: 'Full House', icon: '<i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i><i class="fas fa-dice-one"></i><i class="fas fa-dice-two"></i><i class="fas fa-dice-two"></i>' },
    { key: 'chance', label: 'Chance', icon: '<i class="fas fa-question"></i>' },
    { key: 'yatzy', label: 'Yatzy', icon: '<i class="fas fa-dice-six"></i><i class="fas fa-dice-six"></i><i class="fas fa-dice-six"></i><i class="fas fa-dice-six"></i><i class="fas fa-dice-six"></i>' },
    { key: 'total', label: 'TOTAL', type: 'calc' }           // Calculated
];

// App State
let state = {
    players: [],
    // viewMode removed as we now use click-to-show
};

const STORAGE_KEY = 'yatzy_scoreboard_v2';

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

const DEBOUNCE_DELAY = 300; // ms

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

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

function validateScore(categoryKey, value) {
    if (value === '' || value === null) return { valid: true, value: null };
    
    const numValue = parseInt(value);
    if (isNaN(numValue)) return { valid: false, value: null, message: 'Invalid number' };
    
    const config = VALIDATION_RANGES[categoryKey];
    if (!config) return { valid: true, value: numValue }; // No validation for calculated fields
    
    const { min, max, step } = config;
    
    if (numValue < min || numValue > max) {
        return { 
            valid: false, 
            value: numValue, 
            message: `Value must be between ${min} and ${max}` 
        };
    }

    if (step && numValue % step !== 0) {
        return {
            valid: false,
            value: numValue,
            message: `Value must be a multiple of ${step}`
        };
    }
    
    return { valid: true, value: numValue };
}

function updateScore(playerIndex, categoryKey, value, shouldRender = true) {
    const validation = validateScore(categoryKey, value);
    
    if (validation.valid) {
        state.players[playerIndex].scores[categoryKey] = validation.value;
        calculateTotals(playerIndex);
        saveState();
        if (shouldRender) {
            renderTable(); // Re-render to update calculated fields
        } else {
            updateCalculatedDisplay(playerIndex);
        }
    } else {
        // Show validation error - will be handled by input styling
        return false;
    }
    return true;
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

    // 2. Bonus (Threshold 63, Reward 25)
    s['bonus'] = sumUpper >= 63 ? 25 : 0;

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

function updateCalculatedDisplay(playerIndex) {
    // Update calculated cells in the DOM without full re-render
    const colIndex = playerIndex + 1; // +1 for label column
    
    const updateRow = (rowClass, key) => {
        const row = document.querySelector(`tr.${rowClass}`);
        if (row && row.children[colIndex]) {
            row.children[colIndex].textContent = state.players[playerIndex].scores[key] || 0;
        }
    };

    updateRow('row-sum', 'sum_upper');
    updateRow('row-bonus', 'bonus');
    updateRow('row-total', 'total');
}

// --- DOM Rendering ---

function renderTable() {
    const thead = document.getElementById('header-row');
    const tbody = document.getElementById('score-body');
    // const btnText = document.getElementById('toggle-view-btn'); // Removed

    // Update Button Text
    // btnText.textContent = state.viewMode === 'icon' ? 'Description' : 'Icons'; // Removed

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
            tdLabel.classList.add('calc-label');
        } else {
            // Container for Icon + Description
            const container = document.createElement('div');
            container.className = 'label-container';
            
            // Icon
            const iconSpan = document.createElement('div');
            iconSpan.className = 'cat-icon';
            iconSpan.innerHTML = cat.icon;
            
            // Description (always visible)
            const descSpan = document.createElement('div');
            descSpan.className = 'cat-desc';
            descSpan.textContent = cat.label;
            
            container.appendChild(iconSpan);
            container.appendChild(descSpan);
            tdLabel.appendChild(container);
            
            // Toggle description logic removed - always visible
        }
        
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
                input.setAttribute('inputmode', 'numeric'); // Show numeric keyboard on mobile
                input.value = scoreVal;
                input.placeholder = '-';
                
                // Set min/max/step attributes for validation
                const config = VALIDATION_RANGES[cat.key];
                if (config) {
                    input.min = config.min;
                    input.max = config.max;
                    if (config.step) input.step = config.step;
                }
                
                // Debounced input handler
                const handleInput = debounce((val) => {
                    const success = updateScore(index, cat.key, val, false);
                    if (success) {
                        input.classList.remove('invalid-input');
                        input.title = '';
                    } else {
                        const v = validateScore(cat.key, val);
                        input.classList.add('invalid-input');
                        input.title = v.message || 'Invalid value';
                    }
                }, DEBOUNCE_DELAY);

                // Input event (covers keyup, paste, etc.)
                input.oninput = (e) => {
                    // Check validity immediately for UI feedback if desired, 
                    // but we'll leave it to debounce to avoid flickering
                    handleInput(e.target.value);
                };
                
                // Validation on blur (when user leaves the field)
                input.onblur = (e) => {
                    const validation = validateScore(cat.key, e.target.value);
                    if (!validation.valid) {
                        e.target.classList.add('invalid-input');
                        e.target.title = validation.message || 'Invalid value';
                        // Optional: Revert to last valid state in UI? 
                        // For now we leave it invalid in UI but State is not updated with invalid value
                    } else {
                        e.target.classList.remove('invalid-input');
                        e.target.title = '';
                        // Ensure final value is saved (in case debounce didn't fire yet)
                        updateScore(index, cat.key, e.target.value, false);
                    }
                };
                
                // Check if current value is valid on render
                if (scoreVal !== '') {
                    const validation = validateScore(cat.key, scoreVal);
                    if (!validation.valid) {
                        input.classList.add('invalid-input');
                        input.title = validation.message || 'Invalid value';
                    }
                }
                
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
    const infoDialog = document.getElementById('info-dialog');
    const addBtn = document.getElementById('add-player-btn');
    const confirmBtn = document.getElementById('confirm-add-player');
    const inputName = document.getElementById('new-player-name');
    const resetBtn = document.getElementById('reset-btn');
    const infoBtn = document.getElementById('info-btn');

    // Dialog Logic
    addBtn.addEventListener('click', () => {
        inputName.value = '';
        dialog.showModal();
    });

    infoBtn.addEventListener('click', () => {
        document.getElementById('app-version').textContent = APP_VERSION;
        infoDialog.showModal();
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
}

// toggleViewMode removed
