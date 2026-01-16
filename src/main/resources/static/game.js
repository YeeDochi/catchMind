// [CatchMind] game.js - 이미지 전송 기능 통합 버전

// --- 1. 전역 변수 및 초기화 ---
window.stompClient = null;
window.myNickname = null;
window.myUid = null;
window.currentRoomId = null;
window.isMyTurn = false;
window.isGameEnded = false;
let pendingConfirmCallback = null;

// 그리기 관련 변수
const canvas = document.getElementById('gameCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let isDrawing = false;
let lastX = 0, lastY = 0;

// DOM 헬퍼
const getEl = (id) => document.getElementById(id);

// UID 생성
function getOrCreateUid() {
    let uid = localStorage.getItem('cm_uid');
    if (!uid) {
        uid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('cm_uid', uid);
    }
    return uid;
}

window.addEventListener('load', () => {
    window.myUid = getOrCreateUid();
    init();
});

function init() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') document.body.classList.add('dark-mode');
    const themeBtn = getEl('themeBtn');
    if(themeBtn) themeBtn.innerText = (savedTheme === 'dark') ? 'Light' : 'Dark';

    const savedNick = localStorage.getItem('nickname');
    if (savedNick) {
        console.log("자동 로그인: " + savedNick);
        window.myNickname = savedNick;
        const input = getEl('nicknameInput');
        if(input) input.value = savedNick;
        completeLogin();
    }
}

// --- 2. 로그인 ---
function goToLobby() {
    const input = getEl('nicknameInput');
    const val = input ? input.value.trim() : "";
    if (!val) return showAlert("닉네임을 입력하세요!");
    localStorage.setItem('nickname', val);
    window.myNickname = val;
    completeLogin();
}

function completeLogin() {
    const welcome = getEl('welcome-msg');
    if(welcome) welcome.innerText = `${window.myNickname}님 환영합니다!`;

    // 2. [추가] 헤더에 있는 로그인 정보 표시 영역 켜기
    const loggedInArea = getEl('loggedInArea');
    const userNickname = getEl('userNickname');

    if(loggedInArea) loggedInArea.classList.remove('hidden'); // 숨김 해제
    if(userNickname) userNickname.innerText = window.myNickname; // 이름 넣기

    // 3. 화면 전환 (기존)
    const loginScreen = getEl('login-screen');
    const lobbyScreen = getEl('lobby-screen');
    const gameScreen = getEl('game-screen');

    if(loginScreen) loginScreen.classList.add('hidden');
    if(lobbyScreen) lobbyScreen.classList.remove('hidden');
    if(gameScreen) gameScreen.classList.add('hidden');

    loadRooms();
}

// --- 3. 방 관리 ---
function loadRooms() {
    fetch('/catchmind/api/rooms').then(res => res.json()).then(rooms => {
        const list = getEl('room-list');
        if(!list) return;
        if (!rooms || rooms.length === 0) {
            list.innerHTML = '<li style="padding:20px; text-align:center; color:var(--text-secondary);">개설된 방이 없습니다.</li>';
        } else {
            list.innerHTML = '';
            rooms.forEach(room => {
                const li = document.createElement('li');
                li.className = 'room-item';
                li.innerHTML = `
                    <span style="font-weight:600;">${room.roomName}</span> 
                    <button class="btn-default" onclick="joinRoom('${room.roomId}', '${room.roomName}')" style="font-size:12px;">참가</button>
                `;
                list.appendChild(li);
            });
        }
    }).catch(err => console.error(err));
}

function createRoom() {
    const nameInput = getEl('roomNameInput');
    const roundsInput = getEl('roundsInput');
    const name = nameInput ? nameInput.value : "캐치마인드";
    const rounds = roundsInput ? roundsInput.value : 5;
    if(!name) return showAlert("방 제목을 입력하세요!");
    fetch(`/catchmind/api/rooms?name=${encodeURIComponent(name)}&rounds=${rounds}`, { method: 'POST' })
        .then(res => res.json())
        .then(room => joinRoom(room.roomId, room.roomName))
        .catch(err => showAlert("방 생성 실패"));
}

function joinRoom(roomId, roomName) {
    fetch(`/catchmind/api/rooms/${roomId}`)
        .then(res => { if (!res.ok) throw new Error("방을 찾을 수 없습니다."); return res.json(); })
        .then(room => {
            if (room.playing) return showAlert("이미 게임이 진행 중입니다!");
            enterRoomProcess(roomId, roomName);
        })
        .catch(err => { showAlert(err.message); loadRooms(); });
}

// --- 4. 게임방 입장 & 소켓 ---
function enterRoomProcess(roomId, roomName) {
    window.currentRoomId = roomId;
    window.isGameEnded = false;

    const titleText = getEl('room-title-text');
    if(titleText) titleText.innerText = roomName;
    getEl('lobby-screen').classList.add('hidden');
    getEl('game-screen').classList.remove('hidden');
    const msgs = getEl('messages');
    if(msgs) msgs.innerHTML = '';

    const socket = new SockJS('/catchmind/ws');
    window.stompClient = Stomp.over(socket);
    window.stompClient.debug = null;

    window.stompClient.connect({}, function (frame) {
        showChat('SYSTEM', '서버에 연결되었습니다.');
        window.stompClient.send(`/app/${roomId}/join`, {}, JSON.stringify({ type: 'JOIN', sender: window.myNickname, senderId: window.myUid }));

        // 그리기 구독
        window.stompClient.subscribe(`/topic/${roomId}/draw`, function (msg) {
            if(window.isGameEnded) return;
            const body = JSON.parse(msg.body);
            if (body.type === 'DRAW' && body.senderId !== window.myUid) {
                drawLine(body.prevX, body.prevY, body.x, body.y, body.color, false);
            } else if (body.type === 'CLEAR') {
                if(ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        });

        // 채팅/게임 구독
        window.stompClient.subscribe(`/topic/${roomId}/chat`, function (msg) {
            const body = JSON.parse(msg.body);
            if (body.type === 'KICK') { if (body.senderId === window.myUid) { showAlert(body.content); exitRoom(); } return; }
            if (body.type === 'GAME_OVER') { window.isGameEnded = true; showRanking(body.rankings); return; }
            if (window.isGameEnded) return;

            if (body.type === 'START') { handleGameStart(body); }
            else if (body.type === 'SELECT_WORD') { handleSelectWord(body); }
            else { showChat(body.sender, body.content); }
        });
    }, function(err){ showAlert("서버 연결 끊김"); exitRoom(); });
}

// --- 5. 게임 로직 ---
function startGame() { if(window.stompClient) window.stompClient.send(`/app/${window.currentRoomId}/start`, {}, JSON.stringify({ sender: window.myNickname, senderId: window.myUid })); }

function resetGameState() {
    window.isMyTurn = false; isDrawing = false;
    getEl('chatInput').disabled = false;
    getEl('canvas-container').classList.remove('my-turn');
    getEl('secret-area').style.display = 'none';
    getEl('startBtn').style.display = 'none';
}

function handleSelectWord(msg) {
    resetGameState();
    const status = getEl('game-status');
    if(status && msg.currentRound) status.innerText = `Round ${msg.currentRound}`;
    if (msg.drawerId === window.myUid) {
        getEl('word-select-area').style.display = 'block';
        const btnArea = getEl('candidate-buttons');
        btnArea.innerHTML = '';
        msg.candidates.forEach(word => {
            const btn = document.createElement('button');
            btn.className = 'btn-default'; btn.innerText = word;
            btn.onclick = () => selectWord(word);
            btnArea.appendChild(btn);
        });
        showChat("SYSTEM", "주제어를 선택하세요!");
    } else {
        showChat("SYSTEM", "출제자가 단어를 선택 중입니다...");
    }
}

function selectWord(word) {
    window.stompClient.send(`/app/${window.currentRoomId}/choose`, {}, JSON.stringify({ senderId: window.myUid, content: word }));
    getEl('word-select-area').style.display = 'none';
}

function sendManualWord() {
    const input = getEl('manualWordInput');
    const word = input.value.trim();
    if(!word) return;
    window.stompClient.send(`/app/${window.currentRoomId}/input`, {}, JSON.stringify({ senderId: window.myUid, content: word }));
    getEl('word-select-area').style.display = 'none';
}

function handleGameStart(msg) {
    getEl('word-select-area').style.display = 'none';
    if(ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    showChat('SYSTEM', msg.content);

    const statusSpan = getEl('game-status');
    if (msg.drawerId === window.myUid) {
        window.isMyTurn = true;
        if(statusSpan) { statusSpan.innerText = "그리는 중"; statusSpan.style.background = "#2da44e"; }
        getEl('secret-area').style.display = 'inline-block';
        getEl('secret-text').innerText = msg.answer;
        getEl('canvas-container').classList.add('my-turn');
        getEl('chatInput').disabled = true; // 출제자는 채팅 불가
    } else {
        window.isMyTurn = false;
        if(statusSpan) { statusSpan.innerText = `출제자: ${msg.drawer}`; statusSpan.style.background = "#6e7681"; }
    }
}

// --- 6. 캔버스 ---
function drawLine(x1, y1, x2, y2, color, emit) {
    if(!ctx) return;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke(); ctx.closePath();
    if (emit && window.stompClient) {
        window.stompClient.send(`/app/${window.currentRoomId}/draw`, {}, JSON.stringify({ type: 'DRAW', sender: window.myNickname, senderId: window.myUid, prevX: x1, prevY: y1, x: x2, y: y2, color: color }));
    }
}
if(canvas) {
    canvas.addEventListener('mousedown', e => { if(window.isMyTurn){ isDrawing=true; lastX=e.offsetX; lastY=e.offsetY; } });
    canvas.addEventListener('mousemove', e => { if(isDrawing && window.isMyTurn){ drawLine(lastX, lastY, e.offsetX, e.offsetY, getEl('colorPicker').value, true); lastX=e.offsetX; lastY=e.offsetY; } });
    canvas.addEventListener('mouseup', () => isDrawing=false);
    canvas.addEventListener('mouseout', () => isDrawing=false);
}
function clearCanvas() {
    if(!window.isMyTurn) return;
    if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height);
    if(window.stompClient) window.stompClient.send(`/app/${window.currentRoomId}/draw`, {}, JSON.stringify({ type: 'CLEAR', sender: window.myNickname, senderId: window.myUid }));
}

// --- 7. 채팅 및 이미지 기능 (GameCore 통합) ---
function sendChat() {
    const input = getEl('chatInput');
    const val = input.value.trim();
    if(!val) return;
    if(window.stompClient) {
        window.stompClient.send(`/app/${window.currentRoomId}/chat`, {}, JSON.stringify({ type: 'CHAT', sender: window.myNickname, senderId: window.myUid, content: val }));
    }
    input.value = '';
}

// [추가] 이미지 메시지 전송 (HTML 태그로 변환)
function sendImageMessage(url) {
    if (!window.stompClient || !window.currentRoomId) return;
    const imgTag = `<img src="${url}" class="chat-img">`;
    window.stompClient.send(`/app/${window.currentRoomId}/chat`, {}, JSON.stringify({
        type: 'CHAT', sender: window.myNickname, senderId: window.myUid, content: imgTag
    }));
}

function showChat(sender, msg) {
    const msgs = getEl('messages');
    if(!msgs) return;
    const div = document.createElement('div');
    const isMe = (sender === window.myNickname);
    const isSystem = (sender === 'SYSTEM');

    if (isSystem) {
        div.className = 'msg-system';
        div.innerHTML = `<span class="badge">${msg}</span>`;
    } else {
        div.className = isMe ? 'msg-row msg-right' : 'msg-row msg-left';
        // 이미지 로드 시 스크롤 처리
        const contentHtml = `<div class="msg-bubble">${msg}</div>`;
        div.innerHTML = isMe ? contentHtml : `<div class="msg-name">${sender}</div>${contentHtml}`;
    }
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    // 이미지가 있다면 로드 후 스크롤 한 번 더
    const imgs = div.querySelectorAll('img');
    imgs.forEach(img => img.onload = () => msgs.scrollTop = msgs.scrollHeight);
}

// --- 8. 이미지 갤러리 로직 (Yacht Dice GameCore 복사) ---
function openImageModal() {
    const modal = getEl('image-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    loadImages();
}
function closeImageModal() {
    getEl('image-modal').classList.add('hidden');
    getEl('image-modal').style.display = 'none';
    getEl('linkInput').value = '';
}
function loadImages() {
    const container = getEl('server-img-list');
    container.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#888;">로딩 중...</div>';
    const filter = getEl('starFilterCheckbox');
    const isFilterOn = filter ? filter.checked : false;

    fetch(`/api/images/list?username=${encodeURIComponent(window.myNickname)}`)
        .then(res => res.json())
        .then(list => {
            container.innerHTML = '';
            if(!list || list.length === 0) {
                container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#888;">이미지가 없습니다.</div>';
                return;
            }
            if(isFilterOn) list = list.filter(img => img.isStarred);
            list.sort((a,b) => (a.isStarred === b.isStarred) ? b.id - a.id : (a.isStarred ? -1 : 1));

            list.forEach(img => {
                const div = document.createElement('div');
                div.style.cssText = `background-image: url('${img.url}'); background-size: cover; background-position: center; height: 100px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color); position: relative;`;
                div.onclick = () => showConfirm("이 이미지를 전송하시겠습니까?", () => { sendImageMessage(img.url); closeImageModal(); });

                // 별표 (즐겨찾기)
                const star = document.createElement('div');
                star.innerHTML = img.isStarred ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
                star.style.cssText = `position: absolute; top: 5px; right: 5px; color: ${img.isStarred ? '#ffc107' : '#ccc'}; background: rgba(0,0,0,0.3); border-radius: 50%; width: 24px; height: 24px; display: flex; justify-content: center; align-items: center;`;
                star.onclick = (e) => { e.stopPropagation(); toggleStar(img.id); };

                div.appendChild(star);
                container.appendChild(div);
            });
        })
        .catch(err => container.innerHTML = '<div style="text-align:center;">로드 실패</div>');
}
function toggleStar(id) {
    fetch(`/api/images/${id}/star?username=${encodeURIComponent(window.myNickname)}`, { method: 'POST' })
        .then(() => loadImages());
}
function uploadFile(input) {
    const file = input.files[0];
    if(!file) return;
    showConfirm(`'${file.name}' 업로드?`, () => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("username", window.myNickname);
        formData.append("gameType", "catchmind"); // 게임 타입 지정
        fetch('/api/images/upload', { method: 'POST', body: formData }).then(res => {
            if(res.ok) loadImages(); else showAlert("업로드 실패");
        });
    });
}
function addExternalLink() {
    const url = getEl('linkInput').value.trim();
    if(!url) return showAlert("URL 입력!");
    showConfirm("링크 등록?", () => {
        const formData = new FormData();
        formData.append("url", url);
        formData.append("username", window.myNickname);
        formData.append("gameType", "catchmind");
        fetch('/api/images/link', { method: 'POST', body: formData }).then(res => {
            if(res.ok) { getEl('linkInput').value=''; loadImages(); } else showAlert("등록 실패");
        });
    });
}

// --- 9. 유틸리티 (모달, 테마) ---
function showConfirm(msg, callback) {
    getEl('confirm-msg-text').innerText = msg;
    getEl('confirm-modal').classList.remove('hidden');
    pendingConfirmCallback = callback;
}
function closeConfirm() { getEl('confirm-modal').classList.add('hidden'); pendingConfirmCallback = null; }
function confirmOk() { if(pendingConfirmCallback) pendingConfirmCallback(); closeConfirm(); }

function showRanking(rankings) {
    getEl('ranking-modal').classList.remove('hidden');
    fireConfetti();
    const list = getEl('ranking-list');
    list.innerHTML = '';
    rankings.forEach((p, i) => {
        const li = document.createElement('li');
        li.style.cssText = "padding:10px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between;";
        const rankIcon = i === 0 ? '👑 ' : `<b>#${i+1}</b> `;
        li.innerHTML = `<span>${rankIcon}${p.nickname}</span> <span style="color:var(--btn-primary-bg); font-weight:bold;">${p.point} pts</span>`;
        list.appendChild(li);
    });
}
function closeRanking() { getEl('ranking-modal').classList.add('hidden'); exitRoom(); }
function exitRoom() {
    if(window.stompClient) { window.stompClient.disconnect(); window.stompClient = null; }
    getEl('game-screen').classList.add('hidden'); getEl('lobby-screen').classList.remove('hidden'); loadRooms();
}
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    getEl('themeBtn').innerText = isDark ? 'Light' : 'Dark';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}
function showAlert(msg) {
    const modal = getEl('alert-modal');
    if (modal) { getEl('alert-msg-text').innerText = msg; modal.classList.remove('hidden'); } else alert(msg);
}
function closeAlert() { getEl('alert-modal').classList.add('hidden'); }
function fireConfetti() {
    if(typeof confetti === 'undefined') return;
    var duration = 3000; var end = Date.now() + duration;
    (function frame() {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 } });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}
function logout() {
    showConfirm("로그아웃 하시겠습니까?", () => {
        // 1. 로컬 스토리지 정보 삭제
        localStorage.removeItem('nickname');
        localStorage.removeItem('token'); // 토큰이 있다면 삭제

        // 2. 소켓 연결 끊기
        if(window.stompClient) {
            window.stompClient.disconnect();
            window.stompClient = null;
        }

        // 3. 알림 후 새로고침
        showAlert("로그아웃 되었습니다.");
        setTimeout(() => {
            location.reload();
        }, 500);
    });
}
// --- Window 등록 ---
window.toggleTheme = toggleTheme;
window.goToLobby = goToLobby;
window.loadRooms = loadRooms;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendChat = sendChat;
window.sendManualWord = sendManualWord;
window.startGame = startGame;
window.clearCanvas = clearCanvas;
window.closeRanking = closeRanking;
window.exitRoom = exitRoom;
window.showAlert = showAlert;
window.closeAlert = closeAlert;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.loadImages = loadImages;
window.uploadFile = uploadFile;
window.addExternalLink = addExternalLink;
window.showConfirm = showConfirm;
window.closeConfirm = closeConfirm;
window.confirmOk = confirmOk;
window.logout = logout;