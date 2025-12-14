// --- Configuration ---
const BACKEND_URL = "https://studymod.onrender.com"; 
// const BACKEND_URL = "http://localhost:8080"; 

const API_BASE = BACKEND_URL + "/api"; 
const MEDIA_BASE = BACKEND_URL

// --- State ---
let currentUser = null;
let activeSession = null;
let timerInterval = null;
let secondsElapsed = 0;
let currentAudio = new Audio();
currentAudio.crossOrigin = "anonymous";
let currentSoundId = null;
// Visualizer Variables
let audioContext = null;
let analyser = null;
let dataArray = null;
let canvas, ctx;
let isVisualizerActive = false;

//Random pet actions
let petActionInterval = null;
const PET_ACTIONS = ['action-wink', 'action-scan', 'action-jump', 'action-surprise'];

// --- DOM Elements ---
const views = {
    auth: document.getElementById('auth-view'),
    dashboard: document.getElementById('dashboard-view')
};
const tabs = {
    study: document.getElementById('tab-study'),
    analytics: document.getElementById('tab-analytics')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is stored in local storage (optional persistence)
    // For now, we start at login
});

// --- Auth Functions ---
document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // 1. Clear previous errors
    const errorEl = document.getElementById('auth-error');
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const isRegister = document.querySelector('.btn-primary').textContent === 'Register';

    const endpoint = isRegister ? '/users/register' : '/users/login';
    const payload = isRegister 
        ? { username, password, timezone: "UTC" } 
        : { username, password };

    try {
        const res = await fetch(API_BASE + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 2. Check for backend error message
        if (!res.ok) {
            // Usually Spring Boot sends a JSON object with "message" or just text
            const errorText = await res.text();
            // Try parsing JSON if possible, otherwise use raw text
            let displayMsg = errorText;
            try {
                const errJson = JSON.parse(errorText);
                if(errJson.message) displayMsg = errJson.message;
            } catch(e) {}
            
            throw new Error(displayMsg || "Authentication Failed");
        }
        
        const data = await res.json();
        
        if (isRegister) {
            alert("Registration Successful! Please Login."); // Keep alert for success only
            toggleAuthMode();
        } else {
            currentUser = data;
            enterDashboard();
        }
    } catch (err) {
        // 3. Display Error in the HTML div
        errorEl.textContent = "ACCESS DENIED: " + err.message;
        errorEl.classList.remove('hidden');
    }
});

document.getElementById('btn-toggle-reg').addEventListener('click', toggleAuthMode);

function toggleAuthMode() {
    const title = document.getElementById('auth-title');
    const btnMain = document.querySelector('#auth-form .btn-primary');
    const btnToggle = document.getElementById('btn-toggle-reg');
    
    if (btnMain.textContent === 'Login') {
        title.textContent = 'New User Entry';
        btnMain.textContent = 'Register';
        btnToggle.textContent = 'Back to Login';
    } else {
        title.textContent = 'System Access';
        btnMain.textContent = 'Login';
        btnToggle.textContent = 'Switch to Register';
    }
}

function enterDashboard() {
    views.auth.classList.add('hidden');
    views.dashboard.classList.remove('hidden');
    document.getElementById('display-username').textContent = currentUser.username.toUpperCase();
    loadSounds();
    loadCyberPet();
    initPetRandomActions();
    initPetEyeTracking();
}

document.getElementById('nav-logout').addEventListener('click', () => {
    if(activeSession) stopSession();
    currentUser = null;
    currentAudio.pause();
    views.dashboard.classList.add('hidden');
    views.auth.classList.remove('hidden');
    // Reset forms
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
});

// --- Tab Switching ---
document.getElementById('nav-study').addEventListener('click', () => switchTab('study'));
document.getElementById('nav-analytics').addEventListener('click', () => {
    switchTab('analytics');
    loadAnalytics();
});

function switchTab(tabName) {
    // Buttons
    document.getElementById('nav-study').classList.toggle('active', tabName === 'study');
    document.getElementById('nav-study').classList.toggle('btn-secondary', tabName !== 'study');
    
    document.getElementById('nav-analytics').classList.toggle('active', tabName === 'analytics');
    document.getElementById('nav-analytics').classList.toggle('btn-secondary', tabName !== 'analytics');

    // Content
    tabs.study.classList.toggle('hidden', tabName !== 'study');
    tabs.analytics.classList.toggle('hidden', tabName !== 'analytics');
}

// --- Sounds Logic ---
async function loadSounds() {
    try {
        const res = await fetch(`${API_BASE}/sounds`);
        const sounds = await res.json();
        const container = document.getElementById('sound-grid');
        container.innerHTML = ''; // Clear loading text

        sounds.forEach(sound => {
            const btn = document.createElement('button');
            btn.className = 'sound-btn';
            btn.textContent = sound.name;
            btn.dataset.id = sound.id;
            btn.onclick = () => toggleSound(sound, btn);
            container.appendChild(btn);
        });
    } catch (err) {
        console.error("Failed to load sounds", err);
    }
}

function toggleSound(sound, btnElement) {
    // --- Initialize Visualizer on first interaction ---
    if (!audioContext) {
        initVisualizer();
    }
    // Resume context if it was suspended (browser policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const allBtns = document.querySelectorAll('.sound-btn');
    
    // Stop if playing same sound
    if (currentSoundId === sound.id) {
        currentAudio.pause();
        currentSoundId = null;
        btnElement.classList.remove('active');
        document.getElementById('now-playing').classList.add('hidden');
        return;
    }

    // Play new sound
    allBtns.forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    
    currentAudio.src = MEDIA_BASE + sound.fileUrl;
    currentAudio.loop = sound.loopable;
    currentAudio.play().catch(e => console.error("Playback Error:", e));
    currentSoundId = sound.id;

    document.getElementById('sound-name').textContent = sound.name;
    document.getElementById('now-playing').classList.remove('hidden');
}

// --- Session Logic ---
document.getElementById('btn-start').addEventListener('click', startSession);
document.getElementById('btn-stop').addEventListener('click', stopSession);

async function startSession() {
    const subject = document.getElementById('subject').value;
    const tag = document.getElementById('tag').value;

    // --- 1. Validation ---
    if (!currentUser || !currentUser.id) {
        alert("System Error: User ID not found. Please re-login.");
        return;
    }

    if (!subject) { alert("Subject required"); return; }

    // --- 2. Ghost Mode Logic (New) ---
    // We add a safety check (?.value) in case the dropdown doesn't exist in your HTML yet
    const ghostSelect = document.getElementById('ghost-mode-select');
    const ghostMode = ghostSelect ? ghostSelect.value : "NONE";
    
    // Reset Ghost State
    ghostDuration = 0;
    isGhostActive = false;
    const ghostContainer = document.getElementById('ghost-container');
    if(ghostContainer) ghostContainer.classList.add('hidden');

    if (ghostMode !== "NONE" && ghostMode) {
        try {
            const res = await fetch(`${API_BASE}/analytics/ghost/${currentUser.id}?mode=${ghostMode}`);
            if(res.ok) {
                const duration = await res.json(); // returns seconds
                
                if (duration > 0) {
                    ghostDuration = duration;
                    isGhostActive = true;
                    
                    // UI Setup
                    if(ghostContainer) {
                        ghostContainer.classList.remove('hidden');
                        document.getElementById('ghost-bar').style.width = "0%";
                        document.getElementById('player-bar').style.width = "0%";
                        document.getElementById('ghost-status').textContent = `TARGET: ${Math.floor(duration/60)} MINS`;
                        document.getElementById('ghost-status').style.color = "#888";
                    }
                }
            }
        } catch (err) {
            console.error("Ghost Load Failed", err);
        }
    }

    // --- 3. Start Actual Session (Original Logic) ---
    try {
        console.log("Sending Request...", { subject, tag, userId: currentUser.id }); 

        const res = await fetch(`${API_BASE}/sessions/start?id=${currentUser.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, tag })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || "Server refused connection");
        }

        activeSession = await res.json();

        // UI Update
        document.getElementById('session-setup').classList.add('hidden');
        document.getElementById('session-active').classList.remove('hidden');
        document.getElementById('active-subject').textContent = activeSession.subject.toUpperCase();
        document.getElementById('active-tag').textContent = activeSession.tag || "GENERAL";
        
        // --- 4. Start Timer ---
        secondsElapsed = 0;
        updateTimerDisplay(); // Initial call
        if (timerInterval) clearInterval(timerInterval); // Clear existing just in case
        
        timerInterval = setInterval(() => {
            secondsElapsed++;
            updateTimerDisplay();
        }, 1000);

    } catch (err) {
        console.error("Start Session Error:", err);
        alert("Failed: " + err.message);
    }
}

async function stopSession() {
    if (!activeSession) return;

    try {
        await fetch(`${API_BASE}/sessions/stop/${activeSession.id}`, { method: 'POST' });
        
        clearInterval(timerInterval);
        activeSession = null;
        
        // UI Reset
        document.getElementById('session-active').classList.add('hidden');
        document.getElementById('session-setup').classList.remove('hidden');
        document.getElementById('subject').value = '';
        
        alert("Session Completed & Logged.");

    } catch (err) {
        console.error(err);
    }
}

function updateTimerDisplay() {
    const hrs = Math.floor(secondsElapsed / 3600).toString().padStart(2, '0');
    const mins = Math.floor((secondsElapsed % 3600) / 60).toString().padStart(2, '0');
    const secs = (secondsElapsed % 60).toString().padStart(2, '0');
    document.getElementById('timer-display').textContent = `${hrs}:${mins}:${secs}`;
}

// --- Analytics & AI Logic ---
async function loadAnalytics() {
    if (!currentUser) return;

    try {
        const res = await fetch(`${API_BASE}/analytics/overview/week/${currentUser.id}`);
        const data = await res.json();
        
        // 1. Render Basic Stats
        document.getElementById('stat-total').textContent = `${data.totalMinutes} mins`;
        document.getElementById('stat-avg').textContent = `${data.avgPerDay.toFixed(1)} mins`;
        document.getElementById('stat-peak').textContent = data.mostProductiveDay || "N/A";

        // 2. --- NEW: Render Top Subjects ---
        const listContainer = document.getElementById('top-subjects-list');
        listContainer.innerHTML = ''; // Clear previous

        if(data.topSubjects && data.topSubjects.length > 0) {
            data.topSubjects.forEach((item, index) => {
                // Create a row with a progress bar effect
                const row = document.createElement('div');
                row.className = 'subject-row';
                
                // Calculate percentage for bar width (relative to top subject)
                const maxVal = data.topSubjects[0].minutes;
                const percent = (item.minutes / maxVal) * 100;

                row.innerHTML = `
                    <div class="subj-info">
                        <span class="subj-rank">#${index + 1}</span>
                        <span class="subj-name">${item.subject}</span>
                        <span class="subj-mins">${item.minutes}m</span>
                    </div>
                    <div class="progress-bg">
                        <div class="progress-fill" style="width: ${percent}%"></div>
                    </div>
                `;
                listContainer.appendChild(row);
            });
        } else {
            listContainer.innerHTML = '<p class="text-muted">No subject data recorded yet.</p>';
        }

        // 3. Load AI
        loadAiInsights();

    } catch (err) {
        console.error("Stats Error", err);
    }
}

document.getElementById('btn-refresh-ai').addEventListener('click', loadAiInsights);

async function loadAiInsights() {
    const loadingEl = document.getElementById('ai-loading');
    const contentEl = document.getElementById('ai-content');
    const summaryEl = document.getElementById('ai-summary');
    const actionsEl = document.getElementById('ai-actions');

    contentEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    try {
        const res = await fetch(`${API_BASE}/ai/insight/weekly/${currentUser.id}`, { method: 'POST' });
        const aiData = await res.json();

        summaryEl.textContent = aiData.summary;
        actionsEl.innerHTML = '';
        
        aiData.actionPoints.forEach(point => {
            const div = document.createElement('div');
            div.textContent = point;
            actionsEl.appendChild(div);
        });

        loadingEl.classList.add('hidden');
        contentEl.classList.remove('hidden');

    } catch (err) {
        loadingEl.textContent = "Neural Link Failed.";
        loadingEl.classList.remove('blink');
    }
}

// --- Visualizer Logic (Final Fix) ---

// script.js

function initVisualizer() {
    if (isVisualizerActive) return;

    // ... Audio Context setup (same as before) ...
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(currentAudio);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256; 
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    
    // ... Data Array setup ...
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    canvas = document.getElementById('visualizer-canvas');
    ctx = canvas.getContext('2d');
    
    // CALL RESIZE IMMEDIATELY
    resizeCanvas(); 

    isVisualizerActive = true;
    animateVisualizer();
}

function resizeCanvas() {
    if (canvas) {
        // Set the internal resolution to match the window exactly
        canvas.width = window.innerWidth;
        canvas.height = 350; // Match CSS height
    }
}

// Update size if user resizes browser window
window.addEventListener('resize', resizeCanvas);

function animateVisualizer() {
    requestAnimationFrame(animateVisualizer);
    
    // ... Get Data ...
    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // DYNAMIC WIDTH CALCULATION
    // This ensures bars stretch to fill width regardless of screen size
    const usefulData = Math.floor(dataArray.length * 0.7); // Use 70% of bass frequencies
    const barWidth = canvas.width / usefulData; 
    
    let x = 0;

    for (let i = 0; i < usefulData; i++) {
        const value = dataArray[i];
        const barHeight = (value / 255) * canvas.height;

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#00f3ff');
        gradient.addColorStop(1, '#ff00ff');
        ctx.fillStyle = gradient;

        // Draw bar
        if(value > 5) {
            // barWidth + 1 fills gaps
            ctx.fillRect(x, canvas.height - barHeight, barWidth + 1, barHeight);
        }
        x += barWidth;
    }
}

// --- ZEN MODE LOGIC ---
const btnZen = document.getElementById('btn-zen-mode');

btnZen.addEventListener('click', () => {
    toggleZenMode();
});

function toggleZenMode() {
    const body = document.body;
    const isZen = body.classList.contains('zen-active');

    if (!isZen) {
        // ENTER ZEN
        body.classList.add('zen-active');
        btnZen.textContent = "✖ EXIT ZEN MODE";
        
        // Request Browser Fullscreen
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
        }
    } else {
        // EXIT ZEN
        body.classList.remove('zen-active');
        btnZen.textContent = "⛶ ENTER ZEN MODE";
        
        // Exit Browser Fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// Listener: If user presses ESC key to exit fullscreen, we must update the UI
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        // User pressed ESC, so remove the class
        document.body.classList.remove('zen-active');
        btnZen.textContent = "⛶ ENTER ZEN MODE";
    }
});

// ==========================================
//             GLOBAL UI SOUNDS
// ==========================================

// Load the click sound (Ensure file exists in static/sounds/)
const uiClickSound = new Audio('sounds/click.mp3');
uiClickSound.volume = 0.4; // Adjust volume (0.0 to 1.0)

// Listen for ALL clicks on the page
document.addEventListener('click', (e) => {
    // Check if user clicked a Button (or an icon inside a button)
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        
        // Reset time so it can play rapidly (e.g. double clicks)
        uiClickSound.currentTime = 0;
        
        // Play sound
        uiClickSound.play().catch(err => {
            // Ignore errors (browsers sometimes block audio if not interacted yet)
        });
    }
});

async function loadCyberPet() {
    if (!currentUser) return;

    try {
        const petEl = document.getElementById('cyber-pet');
        const containerEl = petEl.parentElement.parentElement; // The Card container
        const statusText = document.getElementById('pet-status-text');

        // Fetch mood from backend
        // Note: Make sure the URL matches your backend endpoint
        const res = await fetch(`${API_BASE}/analytics/pet/status/${currentUser.id}`);
        // If your backend returns plain text (String), use res.text(). If JSON, use res.json()
        const mood = await res.text(); 
        
        // Remove old classes
        containerEl.classList.remove('pet-stable', 'pet-hyper', 'pet-critical', 'pet-low_power');

        // Apply new class based on mood
        if (mood === 'HYPER') {
            containerEl.classList.add('pet-hyper');
            statusText.textContent = "STATUS: OVERCHARGE (MAX PERFORMANCE)";
            statusText.style.color = "var(--neon-pink)";
        } 
        else if (mood === 'STABLE') {
            containerEl.classList.add('pet-stable');
            statusText.textContent = "STATUS: HAPPY!";
            statusText.style.color = "var(--neon-blue)";
        } 
        else if (mood === 'CRITICAL') {
            containerEl.classList.add('pet-critical');
            statusText.textContent = "STATUS: CRITICAL (STUDY TO CHARGER YOUR ORB PET))";
            statusText.style.color = "#ff3333";
        }
        else {
            // LOW_POWER or others
            containerEl.classList.add('pet-stable'); // Fallback to stable but maybe dim?
            document.getElementById('cyber-pet').style.opacity = "0.3";
            statusText.textContent = "STATUS: LOW POWER (REQ. STUDY)";
        }

    } catch (err) {
        console.error("Pet System Failure:", err);
    }
}
function initPetRandomActions() {
    // Clear existing interval if any
    if (petActionInterval) clearInterval(petActionInterval);

    // Run a random check every 8 seconds
    petActionInterval = setInterval(() => {
        // 30% chance to perform an action (so it doesn't happen constantly)
        if (Math.random() > 0.7) {
            triggerRandomAction();
        }
    }, 8000);
}

function triggerRandomAction() {
    const petContainer = document.querySelector('.pet-container');
    const statusText = document.getElementById('pet-status-text');
    
    // Don't interrupt if critical (glitching)
    if (petContainer.classList.contains('pet-critical')) return;

    // 1. Pick a random action
    const randomAction = PET_ACTIONS[Math.floor(Math.random() * PET_ACTIONS.length)];
    
    // 2. Apply class
    petContainer.classList.add(randomAction);

    // 3. Optional: Briefly change text
    const originalText = statusText.textContent;
    const originalColor = statusText.style.color;
    
    if (randomAction === 'action-scan') {
        statusText.textContent = "STATUS: SCANNING USER...";
        statusText.style.color = "var(--neon-blue)";
    } else if (randomAction === 'action-surprise') {
        statusText.textContent = "STATUS: DATA SPIKE DETECTED!";
        statusText.style.color = "#fff";
    }

    // 4. Remove after animation finishes (1.5 seconds)
    setTimeout(() => {
        petContainer.classList.remove(randomAction);
        // Restore text
        statusText.textContent = originalText;
        statusText.style.color = originalColor;
    }, 1500);
}

// File: script.js

// Add to state variables
let ghostDuration = 0; // in seconds
let isGhostActive = false;


// 2. Update updateTimerDisplay() to handle the race logic
function updateTimerDisplay() {
    // --- 1. CALCULATE TIME & UPDATE TEXT (This part was missing) ---
    const hrs = Math.floor(secondsElapsed / 3600).toString().padStart(2, '0');
    const mins = Math.floor((secondsElapsed % 3600) / 60).toString().padStart(2, '0');
    const secs = (secondsElapsed % 60).toString().padStart(2, '0');
    
    // Update the HTML text
    const displayElement = document.getElementById('timer-display');
    if (displayElement) {
        displayElement.textContent = `${hrs}:${mins}:${secs}`;
    }

    // Ghost Logic
    if (isGhostActive && ghostDuration > 0) {
        // Calculate percentages (capped at 100%)
        // The "Ghost" moves at a constant "100% per ghostDuration" pace.
        // But wait! A ghost implies replaying a past session.
        // Simplified: The Ghost completes the bar in 'ghostDuration' seconds.
        // You complete the bar in 'ghostDuration' seconds.
        
        const progressPercent = Math.min((secondsElapsed / ghostDuration) * 100, 100);
        
        // Update Bars
        // For visual clarity: Let the "bar" represent the target duration.
        // So both fill up towards 100%.
        document.getElementById('player-bar').style.width = `${progressPercent}%`;
        
        // Visual Feedback
        const statusEl = document.getElementById('ghost-status');
        const playerBar = document.getElementById('player-bar');

        if (secondsElapsed < ghostDuration) {
            // Still chasing
            statusEl.textContent = "CHASING GHOST...";
            playerBar.style.backgroundColor = "var(--neon-blue)";
        } else {
            // You beat the ghost!
            statusEl.textContent = "GHOST DEFEATED (NEW RECORD)";
            statusEl.style.color = "var(--neon-green)";
            playerBar.style.backgroundColor = "var(--neon-green)";
            
            // Optional: Make the bar glow
            playerBar.style.boxShadow = "0 0 15px var(--neon-green)";
        }
    }
}
function initPetEyeTracking() {
    const petBody = document.getElementById('cyber-pet');

    document.addEventListener('mousemove', (e) => {
        // Only run if the pet exists and is visible
        if (!petBody || petBody.offsetParent === null) return;

        // 1. Get Pet's Position on Screen
        const rect = petBody.getBoundingClientRect();
        const petCenterX = rect.left + rect.width / 2;
        const petCenterY = rect.top + rect.height / 2;

        // 2. Calculate Distance from Mouse to Pet Center
        const deltaX = e.clientX - petCenterX;
        const deltaY = e.clientY - petCenterY;

        // 3. Limit the movement (The "Pupil" Logic)
        // We divide by 15 to slow down the movement so eyes don't fly off the face
        // We clamp Math.max/min so it never goes beyond 12px
        const moveX = Math.min(Math.max(deltaX / 15, -12), 12); 
        const moveY = Math.min(Math.max(deltaY / 15, -12), 12);

        // 4. Update CSS Variables
        petBody.style.setProperty('--eye-x', `${moveX}px`);
        petBody.style.setProperty('--eye-y', `${moveY}px`);
    });
}
