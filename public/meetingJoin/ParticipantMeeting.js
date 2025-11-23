class ParticipantMeeting {
    constructor() {
        this.socket = io();
        window.socket = this.socket;

        this.detailsManager = new MeetingDetailsManager();
        this.webrtc = new WebRTCConnectionManager(this.socket);
        this.layoutManager = new VideoLayoutManager(this.webrtc, this.socket);
        this.screenShareManager = new ScreenShareManager(this.webrtc, this.socket);

        this.participants = new Map();
        this.participantsPanelOpen = false;
        this.searchTerm = '';
        this.reactionManager = null;

        this.init().then(() => {
            window.hostMeetingInstance = this;
            console.log('Meeting initialized');
        });
    }

    async init() {
        await this.detailsManager.getUserName();
        this.setupSocketListeners();
        this.setupEventListeners();
        this.detailsManager.updateTime();
        this.joinMeeting();

        const initialized = await this.webrtc.initialize();
        if (initialized) {
            this.showLocalVideo();
            setTimeout(() => {
                this.webrtc.setReady();
            }, 1000);
            this.renderParticipants();

            this.startVideoRefreshMonitor();
        }

        if (window.ReactionManager) {
            this.reactionManager = new ReactionManager(this.socket);
        }

        this.initializePollSystem();
    }

    get meetingId() {
        return this.detailsManager.meetingId;
    }

    get userName() {
        return this.detailsManager.userName;
    }

    get userId() {
        return this.detailsManager.userId;
    }

    get isHost() {
        return this.detailsManager.isHost;
    }

    get isCoHost() {
        return this.detailsManager.isCoHost;
    }

    set isCoHost(value) {
        this.detailsManager.isCoHost = value;
    }

    async initializePollSystem() {
        if (window.initializePollSystem) {
            window.initializePollSystem(this.socket, this.meetingId, this.userId, this.isHost);
            console.log('Poll system initialized for meeting:', this.meetingId);
        }
    }

    startVideoRefreshMonitor() {
        setInterval(() => {
            this.checkAndRefreshMissingVideos();
        }, 3000);
    }

    checkAndRefreshMissingVideos() {
        const videoWrappers = document.querySelectorAll('.video-wrapper[data-socket-id]');
        let refreshNeeded = false;

        videoWrappers.forEach(wrapper => {
            const socketId = wrapper.dataset.socketId;
            if (socketId !== this.socket.id) {
                const video = wrapper.querySelector('.video-frame');
                const remoteStream = this.webrtc.getRemoteStream(socketId);

                if (video && remoteStream && !video.srcObject) {
                    console.log(`Found missing video stream for ${socketId}, refreshing...`);
                    this.webrtc.updateRemoteVideoWithRetry(socketId, remoteStream);
                    refreshNeeded = true;
                }
            }
        });

        if (refreshNeeded) {
            console.log('Refreshed missing video streams');
        }
    }

    refreshParticipantVideos() {
        setTimeout(() => {
            this.attachStreamsToExistingVideos();
        }, 100);
    }

    attachStreamsToExistingVideos() {
        this.layoutManager.attachStreamsToVideos(
            this.webrtc.localStream,
            this.webrtc.isScreenSharing,
            this.webrtc.screenStream
        );
    }

    showLocalVideo() {
        this.participants.set(this.socket.id, {
            socketId: this.socket.id,
            name: this.userName,
            isHost: false,
            isCoHost: false,
            isMuted: false,
            isCameraOff: false,
            isSpotlighted: false,
            isScreenSharing: false,
            handRaised: false
        });
        this.renderParticipants();
        this.renderParticipantsList();
    }

    setupSocketListeners() {
        this.socket.on('joined-meeting', (data) => {
            console.log('Joined meeting as participant:', data);
            this.detailsManager.updateHostStatus(data.isHost || false, false);
            this.updateParticipants(data.participants);
            this.layoutManager.setSpotlightedParticipant(data.spotlightedParticipant);
            this.detailsManager.updateMeetingTitle();
            this.updateRaisedHands(data.raisedHands);
        });

        this.socket.on('participant-joined', (data) => {
            console.log('Participant joined:', data);
            this.updateParticipants(data.participants);
            this.showToast(`${data.participant.name} joined the meeting`);

            setTimeout(() => {
                this.refreshParticipantVideos();
            }, 500);
        });

        this.socket.on('participant-left', (data) => {
            console.log('Participant left:', data);
            this.layoutManager.removeParticipantVideo(data.socketId);
            this.updateParticipants(data.participants);
            this.showToast(`${data.participantName} left the meeting`);
            this.webrtc.removePeerConnection(data.socketId);
        });

        this.socket.on('participant-video-changed', (data) => {
            console.log('Participant video changed:', data);
            this.layoutManager.updateRemoteVideoDisplay(data.socketId, data.isCameraOff);
            this.updateParticipants(data.participants);
        });

        this.socket.on('participant-spotlighted', (data) => {
            console.log('Participant spotlighted:', data);
            this.layoutManager.setSpotlightedParticipant(data.spotlightedParticipant);
            this.updateParticipants(data.participants);
        });

        this.socket.on('spotlight-removed', (data) => {
            console.log('Spotlight removed:', data);
            this.layoutManager.setSpotlightedParticipant(null);
            this.updateParticipants(data.participants);
        });

        this.socket.on('participant-pinned', (data) => {
            console.log('Participant pinned:', data);
            this.layoutManager.setPinnedParticipant(data.pinnedParticipant);
            this.renderParticipants();
        });

        this.socket.on('force-mute', (data) => {
            console.log('Force muted:', data);
            this.handleForceMute(data.isMuted);
        });

        this.socket.on('made-cohost', () => {
            console.log('Made co-host');
            this.detailsManager.isCoHost = true;
            this.showToast('You are now a co-host!');
            this.renderParticipants();
            this.renderParticipantsList();
        });

        this.socket.on('kicked-from-meeting', () => {
            console.log('Kicked from meeting');
            document.getElementById('kickedModal').style.display = 'flex';
        });

        this.socket.on('meeting-ended', () => {
            console.log('Meeting ended');
            document.getElementById('meetingEndedModal').style.display = 'flex';
        });

        this.socket.on('participant-muted', (data) => {
            console.log('Participant muted:', data);
            this.layoutManager.updateParticipantAudioIndicator(data.targetSocketId, data.isMuted);
            this.updateParticipants(data.participants);
        });

        this.socket.on('meeting-error', (data) => {
            console.error('Meeting error:', data);
            this.showToast(data.message, 'error');
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 3000);
        });

        this.socket.on('action-error', (data) => {
            console.error('Action error:', data);
            this.showToast(data.message, 'error');
        });

        this.socket.on('hand-raised', (data) => {
            this.updateRaisedHands(data.raisedHands);
            if (this.reactionManager) {
                this.reactionManager.updateHandRaised(data.socketId, data.participantName, true);
            }
        });

        this.socket.on('hand-lowered', (data) => {
            this.updateRaisedHands(data.raisedHands);
            if (this.reactionManager) {
                this.reactionManager.updateHandRaised(data.socketId, data.participantName, false);
            }
        });
    }

    setupEventListeners() {
        document.getElementById('memberToggleBtn')?.addEventListener('click', () => {
            this.toggleParticipantsPanel();
        });

        document.getElementById('closeParticipants')?.addEventListener('click', () => {
            this.closeParticipantsPanel();
        });

        document.getElementById('participantSearch')?.addEventListener('input', (e) => {
            this.searchTerm = e.target.value.toLowerCase();
            this.renderParticipantsList();
        });

        document.getElementById('viewToggle')?.addEventListener('click', () => {
            this.layoutManager.toggleView();
            this.renderParticipants();
            setTimeout(() => {
                this.refreshParticipantVideos();
                this.webrtc.refreshAllRemoteVideos();
            }, 200);
        });

        document.getElementById('micBtn')?.addEventListener('click', (e) => {
            this.toggleMic(e.currentTarget);
        });

        document.getElementById('cameraBtn')?.addEventListener('click', (e) => {
            this.toggleCamera(e.currentTarget);
        });

        document.getElementById('screenShareBtn')?.addEventListener('click', (e) => {
            this.toggleScreenShare(e.currentTarget);
        });

        document.getElementById('leaveCallBtn')?.addEventListener('click', () => {
            this.leaveMeeting();
        });

        document.addEventListener('click', (e) => {
            if (this.participantsPanelOpen &&
                !document.getElementById('participantsPanel')?.contains(e.target) &&
                !document.getElementById('memberToggleBtn')?.contains(e.target)) {
                this.closeParticipantsPanel();
            }
        });
    }

    updateRaisedHands(raisedHands) {
        if (this.reactionManager) {
            this.reactionManager.raisedHands.clear();
            raisedHands.forEach(socketId => {
                this.reactionManager.raisedHands.add(socketId);
            });
            this.reactionManager.updateParticipantsDisplay();
        }
    }

    toggleParticipantsPanel() {
        if (this.participantsPanelOpen) {
            this.closeParticipantsPanel();
        } else {
            this.openParticipantsPanel();
        }
    }

    openParticipantsPanel() {
        this.participantsPanelOpen = true;
        document.getElementById('participantsPanel')?.classList.add('open');
        document.getElementById('videoContainer')?.classList.add('participants-open');
        this.renderParticipantsList();
        const chatBar = document.getElementById("chatBar");
        if (chatBar) chatBar.classList.remove("open");
    }

    closeParticipantsPanel() {
        this.participantsPanelOpen = false;
        document.getElementById('participantsPanel')?.classList.remove('open');
        document.getElementById('videoContainer')?.classList.remove('participants-open');
    }

    renderParticipantsList() {
        const participantsList = document.getElementById('participantsList');
        const participantsPanelCount = document.getElementById('participantsPanelCount');

        if (!participantsList || !participantsPanelCount) return;

        participantsList.innerHTML = '';

        const filteredParticipants = Array.from(this.participants.values()).filter(participant =>
            participant.name.toLowerCase().includes(this.searchTerm)
        );

        participantsPanelCount.textContent = filteredParticipants.length;

        filteredParticipants.forEach(participant => {
            const participantItem = this.createParticipantItem(participant);
            participantsList.appendChild(participantItem);
        });

        if (this.reactionManager) {
            this.reactionManager.onParticipantsUpdated();
        }
    }

    createParticipantItem(participant) {
        const item = document.createElement('div');
        item.className = 'participant-item';
        item.dataset.socketId = participant.socketId;

        const initials = participant.name.split(' ').map(n => n[0]).join('').toUpperCase();

        let roleText = 'Participant';
        let roleClass = 'participant';
        if (participant.isHost) {
            roleText = 'Host';
            roleClass = 'host';
        } else if (participant.isCoHost) {
            roleText = 'Co-Host';
            roleClass = 'cohost';
        }

        const statusIcons = [];
        if (participant.isMuted) {
            statusIcons.push('<div class="status-icon muted"><i class="fas fa-microphone-slash"></i></div>');
        }
        if (participant.isCameraOff) {
            statusIcons.push('<div class="status-icon camera-off"><i class="fas fa-video-slash"></i></div>');
        }

        const dropdownOptions = this.getParticipantDropdownOptions(participant);

        item.innerHTML = `
            <div class="participant-avatar">${initials}</div>
            <div class="participant-info">
                <div class="participant-name-section">${participant.name}</div>
                <div class="participant-role">
                    <span class="role-badge ${roleClass}">${roleText}</span>
                    ${participant.isSpotlighted ? '<i class="fas fa-star" style="color: #fbbf24; margin-left: 4px;"></i>' : ''}
                    ${this.layoutManager.pinnedParticipant === participant.socketId ? '<i class="fas fa-thumbtack" style="color: #10b981; margin-left: 4px;"></i>' : ''}
                </div>
            </div>
            <div class="participant-status">
                ${statusIcons.join('')}
            </div>
            <div class="participant-actions">
                <button class="participant-menu-btn" data-participant-id="${participant.socketId}">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <div class="participant-dropdown" id="dropdown-${participant.socketId}">
                    ${dropdownOptions}
                </div>
            </div>
        `;

        const menuBtn = item.querySelector('.participant-menu-btn');
        const dropdown = item.querySelector('.participant-dropdown');

        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.participant-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('show');
            });
            dropdown.classList.toggle('show');
        });

        const dropdownButtons = dropdown.querySelectorAll('button');
        dropdownButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = button.dataset.action;
                this.handleParticipantAction(action, participant.socketId);
                dropdown.classList.remove('show');
            });
        });

        return item;
    }

    getParticipantDropdownOptions(participant) {
        let options = [];

        if (this.layoutManager.pinnedParticipant === participant.socketId) {
            options.push('<button data-action="unpin"><i class="fas fa-thumbtack"></i> Unpin</button>');
        } else {
            options.push('<button data-action="pin"><i class="fas fa-thumbtack"></i> Pin</button>');
        }

        if (this.isCoHost && !participant.isHost) {
            if (participant.isSpotlighted) {
                options.push('<button data-action="remove-spotlight"><i class="fas fa-star-half-alt"></i> Remove Spotlight</button>');
            } else {
                options.push('<button data-action="spotlight"><i class="fas fa-star"></i> Spotlight</button>');
            }

            options.push(`<button data-action="mute"><i class="fas fa-microphone-slash"></i> ${participant.isMuted ? 'Unmute' : 'Mute'}</button>`);
        }

        return options.join('');
    }

    joinMeeting() {
        this.socket.emit('join-meeting', {
            meetingId: this.meetingId,
            participantName: this.userName,
            userId: this.userId
        });
    }

    updateParticipants(participants) {
        const localParticipant = this.participants.get(this.socket.id);

        this.participants.clear();
        participants.forEach(p => {
            this.participants.set(p.socketId, p);
            if (p.socketId === this.socket.id) {
                this.detailsManager.isCoHost = p.isCoHost;
            }
        });

        if (localParticipant && !this.participants.has(this.socket.id)) {
            this.participants.set(this.socket.id, localParticipant);
        }

        this.renderParticipants();
        this.updateParticipantCount();
        if (this.participantsPanelOpen) {
            this.renderParticipantsList();
        }

        if (window.cameraOffPlaceholderManager) {
            window.cameraOffPlaceholderManager.updateAllParticipants(participants);
        }

        setTimeout(() => {
            this.refreshParticipantVideos();
        }, 200);
    }

    renderParticipants() {
        this.layoutManager.setParticipants(this.participants);

        this.layoutManager.renderParticipants(() => {
            const videoWrappers = document.querySelectorAll('.video-wrapper[data-socket-id]');
            videoWrappers.forEach(wrapper => {
                const socketId = wrapper.dataset.socketId;
                const participant = this.participants.get(socketId);
                if (participant) {
                    this.bindVideoWrapperEvents(wrapper, participant);
                }
            });

            setTimeout(() => {
                this.attachStreamsToExistingVideos();
            }, 100);
        });
    }

    bindVideoWrapperEvents(wrapper, participant) {
        wrapper.addEventListener('dblclick', () => {
            this.layoutManager.setPinnedParticipant(participant.socketId);
            this.socket.emit('pin-participant', { targetSocketId: participant.socketId });
            this.renderParticipants();
            this.showToast(`Pinned ${participant.name}`);
        });

        const dropdownButtons = wrapper.querySelectorAll('.dropdown-menu button');
        dropdownButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = button.dataset.action;
                this.handleParticipantAction(action, participant.socketId);
            });
        });
    }

    handleParticipantAction(action, socketId) {
        switch(action) {
            case 'pin':
                this.layoutManager.setPinnedParticipant(socketId);
                this.socket.emit('pin-participant', { targetSocketId: socketId });
                this.renderParticipants();
                if (this.participantsPanelOpen) {
                    this.renderParticipantsList();
                }
                const participant = this.participants.get(socketId);
                this.showToast(`Pinned ${participant?.name || 'participant'}`);
                break;
            case 'unpin':
                this.layoutManager.setPinnedParticipant(null);
                this.renderParticipants();
                if (this.participantsPanelOpen) {
                    this.renderParticipantsList();
                }
                this.showToast('Unpinned participant');
                break;
            case 'spotlight':
                this.socket.emit('spotlight-participant', { targetSocketId: socketId });
                break;
            case 'remove-spotlight':
                this.socket.emit('remove-spotlight');
                break;
            case 'mute':
                this.socket.emit('mute-participant', { targetSocketId: socketId });
                break;
        }
    }

    handleForceMute(isMuted) {
        const micBtn = document.getElementById('micBtn');
        if (micBtn) {
            micBtn.setAttribute('data-active', !isMuted);
            const icon = micBtn.querySelector('i');
            if (icon) {
                icon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
            }
        }

        this.webrtc.toggleAudio(!isMuted);
        this.showToast(isMuted ? 'You have been muted by the host' : 'You have been unmuted by the host');
    }

    async toggleMic(button) {
        const isActive = button.getAttribute('data-active') === 'true';
        button.setAttribute('data-active', !isActive);

        const icon = button.querySelector('i');
        if (icon) {
            icon.className = isActive ? 'fas fa-microphone-slash' : 'fas fa-microphone';
        }

        await this.webrtc.toggleAudio(!isActive);
        this.socket.emit('toggle-mic', { isMuted: isActive });
    }

    async toggleCamera(button) {
        const isActive = button.getAttribute('data-active') === 'true';
        button.setAttribute('data-active', !isActive);

        const icon = button.querySelector('i');
        if (icon) {
            icon.className = isActive ? 'fas fa-video-slash' : 'fas fa-video';
        }

        await this.webrtc.toggleVideo(!isActive);
        this.socket.emit('toggle-camera', { isCameraOff: isActive });
    }

    async toggleScreenShare(button) {
        const isActive = button.getAttribute('data-active') === 'true';

        if (isActive) {
            await this.screenShareManager.stopScreenShare();
            button.setAttribute('data-active', 'false');
            this.socket.emit('stop-screen-share');
        } else {
            try {
                await this.screenShareManager.startScreenShare();
                button.setAttribute('data-active', 'true');
                this.socket.emit('start-screen-share', { streamId: 'screen' });
            } catch (error) {
                console.error('Failed to start screen share:', error);
                this.showToast('Failed to start screen sharing', 'error');
            }
        }
    }

    updateParticipantCount() {
        const count = this.participants.size;
        const countElement = document.getElementById('participantCount');
        if (countElement) {
            countElement.textContent = count;
        }
    }

    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type === 'error' ? 'error' : type === 'info' ? 'info' : ''}`;
        toast.textContent = message;

        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    leaveMeeting() {
        if (confirm('Are you sure you want to leave the meeting?')) {
            this.webrtc.leaveMeeting();
            this.socket.disconnect();
            window.location.href = '/dashboard';
        }
    }
}

document.addEventListener('click', () => {
    document.querySelectorAll('.participant-dropdown').forEach(dropdown => {
        dropdown.classList.remove('show');
    });
});

document.addEventListener('DOMContentLoaded', () => {
    window.hostMeeting = new ParticipantMeeting();
    console.log('Meeting initialized. Meeting ID:', window.hostMeeting.meetingId);
});

window.getMeetingId = function() {
    return window.location.pathname.split('/').pop();
};

window.showMeetingInfo = function() {
    if (window.hostMeeting && window.hostMeeting.detailsManager) {
        return window.hostMeeting.detailsManager.showMeetingInfo();
    }
    return null;
};

window.getMeetingDetails = function() {
    if (window.hostMeeting && window.hostMeeting.detailsManager) {
        const details = window.hostMeeting.detailsManager.getMeetingDetails();
        if (details) console.table(details);
        return details;
    }
    return null;
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParticipantMeeting;
}
