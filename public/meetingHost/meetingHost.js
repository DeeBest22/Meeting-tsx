class HostMeeting {
  constructor() {
    this.socket = io();
    window.socket = this.socket;
    this.meetingId = window.location.pathname.split('/').pop();

    this.meetingDetails = new MeetingDetails(this.socket, this.meetingId);
    this.webrtc = new EnhancedWebRTCManager(this.socket);
    this.participantManager = new ParticipantManager(this.socket);
    this.videoLayout = new VideoLayout();

    this.reactionManager = null;
    this.shouldAutoStartScreenShare = false;
    this.shouldAutoStopVideo = false;

    this.init().then(() => {
      window.hostMeetingInstance = this;
      window.myName = this.meetingDetails.userName;
      console.log('Host meeting initialized. Host name:', window.myName);
    });
  }

  async init() {
    await this.meetingDetails.getUserName();
    this.checkAutoStopVideoFlag();
    this.checkAutoScreenShareFlag();
    this.setupSocketListeners();
    this.setupEventListeners();
    this.setupPermissionControls();
    this.meetingDetails.updateTime();

    this.meetingDetails.initializeMeetingName();
    this.joinMeeting();
    this.meetingDetails.showMeetingInfo();

    const initialized = await this.webrtc.initialize();
    if (initialized) {
      this.showLocalVideo();
      setTimeout(async () => {
        this.webrtc.setReady();

        if (this.shouldAutoStartScreenShare) {
          await this.autoStartScreenShare();
        }

        if (this.shouldAutoStopVideo) {
          await this.autoStopVideo();
        }
      }, 1000);
    }

    if (window.ReactionManager) {
      this.reactionManager = new ReactionManager(this.socket);
    }
  }

  checkAutoStopVideoFlag() {
    const autoStopVideo = sessionStorage.getItem('autoStopVideo');
    const fromCreateForm = sessionStorage.getItem('fromCreateForm');

    if (autoStopVideo === 'true' && fromCreateForm === 'true') {
      this.shouldAutoStopVideo = true;
      console.log('Auto stop video flag detected');

      sessionStorage.removeItem('autoStopVideo');
      sessionStorage.removeItem('fromCreateForm');
    }
  }

  async autoStopVideo() {
    try {
      console.log('Auto stopping video...');

      if (typeof window.stopVideo === 'function') {
        const success = window.stopVideo();
        if (success) {
          console.log('Video auto-stopped successfully');
          this.meetingDetails.showToast('Video stopped automatically', 'info');
        } else {
          console.log('Failed to auto-stop video');
        }
      } else {
        await this.manualStopVideo();
      }

    } catch (error) {
      console.error('Failed to auto stop video:', error);
    }
  }

  async manualStopVideo() {
    try {
      if (this.webrtc.localStream) {
        const videoTrack = this.webrtc.localStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = false;
          console.log('Local video track disabled via manual method');
        }
      }

      const cameraBtn = document.getElementById('cameraBtn');
      if (cameraBtn) {
        cameraBtn.setAttribute('data-active', 'true');
        const icon = cameraBtn.querySelector('i');
        if (icon) {
          icon.className = 'fas fa-video-slash';
        }
      }

      const localParticipant = this.participantManager.participants.get(this.socket.id);
      if (localParticipant) {
        localParticipant.isCameraOff = true;
      }

      this.socket.emit('toggle-camera', { isCameraOff: true });

      const localVideoWrapper = document.querySelector(`[data-socket-id="${this.socket.id}"]`);
      if (localVideoWrapper) {
        let cameraOffIndicator = localVideoWrapper.querySelector('.camera-off-indicator');
        if (!cameraOffIndicator) {
          cameraOffIndicator = document.createElement('div');
          cameraOffIndicator.className = 'camera-off-indicator';
          cameraOffIndicator.innerHTML = '<i class="fas fa-video-slash"></i>';
          cameraOffIndicator.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 24px;
            z-index: 10;
          `;
          localVideoWrapper.appendChild(cameraOffIndicator);
        }
      }

      console.log('Video stopped successfully via manual method');
      return true;

    } catch (error) {
      console.error('Error in manual stop video:', error);
      return false;
    }
  }

  checkAutoScreenShareFlag() {
    const urlParams = new URLSearchParams(window.location.search);
    this.shouldAutoStartScreenShare = urlParams.get('autoScreenShare') === 'true';
    console.log('Auto screen share flag:', this.shouldAutoStartScreenShare);
  }

  async autoStartScreenShare() {
    try {
      console.log('Auto starting screen share...');

      await this.webrtc.startScreenShare();

      const screenShareBtn = document.getElementById('screenShareBtn');
      if (screenShareBtn) {
        screenShareBtn.setAttribute('data-active', 'true');
        const icon = screenShareBtn.querySelector('i');
        if (icon) {
          icon.className = 'fas fa-stop';
        }
      }

      this.socket.emit('start-screen-share', {
        streamId: 'screen',
        hasComputerAudio: true
      });

      this.meetingDetails.showToast('Screen sharing started automatically', 'success');
      console.log('Auto screen share started successfully');

    } catch (error) {
      console.error('Failed to auto start screen share:', error);
      this.meetingDetails.showToast('Failed to start screen sharing automatically. You can start it manually.', 'warning');
      this.shouldAutoStartScreenShare = false;
    }
  }

  showLocalVideo() {
    this.participantManager.participants.set(this.socket.id, {
      socketId: this.socket.id,
      name: this.meetingDetails.userName,
      isHost: true,
      isCoHost: false,
      isMuted: false,
      isCameraOff: false,
      isSpotlighted: true,
      isScreenSharing: false,
      handRaised: false
    });
    this.videoLayout.spotlightedParticipant = this.socket.id;
    this.renderParticipants();
    this.participantManager.renderParticipantsList(
      (action, socketId) => this.participantManager.handleParticipantAction(action, socketId)
    );
  }

  setupSocketListeners() {
    this.socket.on('joined-meeting', (data) => {
      const { meetingId, isHost } = data;

      if (window.initializePollSystem) {
        window.initializePollSystem(
          this.socket,
          meetingId,
          this.meetingDetails.userId,
          isHost
        );
        console.log('Poll system initialized for meeting:', meetingId);
      } else {
        console.error('Poll system not loaded');
      }

      console.log('Joined meeting as host:', data);
      this.updateParticipants(data.participants);
      if (data.permissions) {
        this.meetingDetails.meetingPermissions = data.permissions;
        this.updatePermissionControls();
      }
      this.meetingDetails.updateMeetingTitle();
      this.updateRaisedHands(data.raisedHands);

      this.socket.emit('meeting-started', {
        meetingId: this.meetingId,
        meetingName: this.meetingDetails.meetingName,
        userId: this.meetingDetails.userId
      });
    });

    this.socket.on('participant-joined', (data) => {
      console.log('Participant joined:', data);
      this.updateParticipants(data.participants);
      this.meetingDetails.showToast(`${data.participant.name} joined the meeting`);
    });

    this.socket.on('participant-left', (data) => {
      console.log('Participant left:', data);
      this.participantManager.removeParticipantVideo(data.socketId);
      this.updateParticipants(data.participants);
      this.meetingDetails.showToast(`${data.participantName} left the meeting`);
      this.webrtc.removePeerConnection(data.socketId);
    });

    this.socket.on('participant-spotlighted', (data) => {
      console.log('Participant spotlighted:', data);
      this.handleSpotlightChange(data.spotlightedParticipant);
      this.updateParticipants(data.participants);
    });

    this.socket.on('spotlight-removed', (data) => {
      console.log('Spotlight removed:', data);
      this.handleSpotlightRemoved();
      this.updateParticipants(data.participants);
    });

    this.socket.on('participant-muted', (data) => {
      console.log('Participant muted:', data);
      this.participantManager.updateParticipantAudio(data.targetSocketId, data.isMuted);
      this.updateParticipants(data.participants);
    });

    this.socket.on('cohost-assigned', (data) => {
      console.log('Co-host assigned:', data);
      this.updateParticipants(data.participants);
      this.meetingDetails.showToast('Co-host assigned successfully');
    });

    this.socket.on('participant-kicked', (data) => {
      console.log('Participant kicked:', data);
      this.participantManager.removeParticipantVideo(data.targetSocketId);
      this.updateParticipants(data.participants);
      this.meetingDetails.showToast('Participant removed from meeting');
    });

    this.socket.on('action-error', (data) => {
      console.error('Action error:', data);
      this.meetingDetails.showToast(data.message, 'error');
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

    this.socket.on('meeting-name-updated', (data) => {
      console.log('Meeting name updated by host:', data);
      this.meetingDetails.meetingName = data.newName;
      this.meetingDetails.updateMeetingTitle();
      this.meetingDetails.showToast(`Meeting renamed to "${data.newName}"`);
    });

    this.socket.on('meeting-permissions-updated', (data) => {
      console.log('Meeting permissions updated:', data);
      this.meetingDetails.meetingPermissions = data.permissions;
      this.meetingDetails.showToast(`Meeting permissions updated by ${data.changedBy}`);
    });
  }

  setupEventListeners() {
    // Both memberToggleBtn and secondParticipantsBtn toggle participants panel
    document.getElementById('memberToggleBtn').addEventListener('click', () => {
      this.participantManager.toggleParticipantsPanel();
    });

    const secondParticipantsBtn = document.getElementById('secondParticipantsBtn');
    if (secondParticipantsBtn) {
      secondParticipantsBtn.addEventListener('click', () => {
        this.participantManager.toggleParticipantsPanel();
      });
    }

    document.getElementById('closeParticipants').addEventListener('click', () => {
      this.participantManager.closeParticipantsPanel();
    });

    document.getElementById('participantSearch').addEventListener('input', (e) => {
      this.participantManager.setSearchTerm(e.target.value);
      this.participantManager.renderParticipantsList(
        (action, socketId) => this.participantManager.handleParticipantAction(action, socketId)
      );
    });

    document.getElementById('viewToggle').addEventListener('click', () => {
      this.toggleView();
    });

    document.getElementById('prevSetBtn').addEventListener('click', () => {
      this.videoLayout.navigateGridSet(-1, this.participantManager.participants.size);
      this.renderParticipants();
    });

    document.getElementById('nextSetBtn').addEventListener('click', () => {
      this.videoLayout.navigateGridSet(1, this.participantManager.participants.size);
      this.renderParticipants();
    });

    document.getElementById('prevSidebarBtn').addEventListener('click', () => {
      const sidebarCount = Array.from(this.participantManager.participants.values())
        .filter(p => !p.isSpotlighted || this.videoLayout.currentView !== 'sidebar').length;
      this.videoLayout.navigateSidebarSet(-1, sidebarCount);
      this.renderParticipants();
    });

    document.getElementById('nextSidebarBtn').addEventListener('click', () => {
      const sidebarCount = Array.from(this.participantManager.participants.values())
        .filter(p => !p.isSpotlighted || this.videoLayout.currentView !== 'sidebar').length;
      this.videoLayout.navigateSidebarSet(1, sidebarCount);
      this.renderParticipants();
    });

    document.getElementById('micBtn').addEventListener('click', (e) => {
      this.toggleMic(e.currentTarget);
    });

    document.getElementById('cameraBtn').addEventListener('click', (e) => {
      this.toggleCamera(e.currentTarget);
    });

    document.getElementById('screenShareBtn').addEventListener('click', (e) => {
      this.toggleScreenShare(e.currentTarget);
    });

    document.getElementById('endCallBtn').addEventListener('click', () => {
      this.endMeeting();
    });

    document.getElementById('meetingTitle').addEventListener('click', () => {
      this.meetingDetails.showMeetingInfo();
    });

    document.getElementById('closeMeetingInfo').addEventListener('click', () => {
      this.meetingDetails.hideMeetingInfo();
    });

    document.getElementById('copyMeetingId').addEventListener('click', () => {
      this.meetingDetails.copyToClipboard(this.meetingId);
    });

    document.getElementById('copyJoinUrl').addEventListener('click', () => {
      const joinUrl = `${window.location.origin}/join/${this.meetingId}`;
      this.meetingDetails.copyToClipboard(joinUrl);
    });

  document.addEventListener('click', (e) => {
  const participantsPanel = document.getElementById('participantsPanel');
  const videoContainer = document.getElementById('videoContainer');
  const memberToggleBtn = document.getElementById('memberToggleBtn');
  const openChatBtn = document.getElementById('openChatBtn');

  if (
    this.participantManager.participantsPanelOpen &&
    !participantsPanel.contains(e.target) &&
    !memberToggleBtn.contains(e.target) &&
    !(secondParticipantsBtn && secondParticipantsBtn.contains(e.target))
  ) {
    // If openChatBtn was clicked:
    if (openChatBtn.contains(e.target)) {
      // Only close participants panel visually
      participantsPanel.classList.remove('open');
      this.participantManager.participantsPanelOpen = false;
      // Don't touch videoContainer
    } else {
      // Normal behavior: fully close panel
      this.participantManager.closeParticipantsPanel();
    }
  }
});

  }

  setupPermissionControls() {
    const chatToggle = document.querySelector('#chat input[type="checkbox"]:first-of-type');
    if (chatToggle) {
      chatToggle.addEventListener('change', (e) => {
        this.meetingDetails.updatePermission('chatEnabled', e.target.checked);
      });
    }

    const fileToggle = document.querySelector('#chat .setting-item:nth-child(3) input[type="checkbox"]');
    if (fileToggle) {
      fileToggle.addEventListener('change', (e) => {
        this.meetingDetails.updatePermission('fileSharing', e.target.checked);
      });
    }

    const emojiToggle = document.querySelector('#chat .setting-item:nth-child(4) input[type="checkbox"]');
    if (emojiToggle) {
      emojiToggle.addEventListener('change', (e) => {
        this.meetingDetails.updatePermission('emojiReactions', e.target.checked);
      });
    }
  }

  updatePermissionControls() {
    const chatToggle = document.querySelector('#chat input[type="checkbox"]:first-of-type');
    if (chatToggle) {
      chatToggle.checked = this.meetingDetails.meetingPermissions.chatEnabled;
    }

    const fileToggle = document.querySelector('#chat .setting-item:nth-child(3) input[type="checkbox"]');
    if (fileToggle) {
      fileToggle.checked = this.meetingDetails.meetingPermissions.fileSharing;
    }

    const emojiToggle = document.querySelector('#chat .setting-item:nth-child(4) input[type="checkbox"]');
    if (emojiToggle) {
      emojiToggle.checked = this.meetingDetails.meetingPermissions.emojiReactions;
    }
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

  joinMeeting() {
    this.socket.emit('join-as-host', {
      meetingId: this.meetingId,
      hostName: this.meetingDetails.userName,
    });
  }

  updateParticipants(participants) {
    this.participantManager.updateParticipants(participants, this.socket.id);
    this.renderParticipants();
    this.participantManager.updateParticipantCount();
    if (this.participantManager.participantsPanelOpen) {
      this.participantManager.renderParticipantsList(
        (action, socketId) => this.participantManager.handleParticipantAction(action, socketId)
      );
    }
  }

  renderParticipants() {
    this.videoLayout.renderParticipants(this.participantManager.participants, this.webrtc);
  }

  handleSpotlightChange(spotlightedSocketId) {
    this.videoLayout.spotlightedParticipant = spotlightedSocketId;
    this.renderParticipants();
    if (this.participantManager.participantsPanelOpen) {
      this.participantManager.renderParticipantsList(
        (action, socketId) => this.participantManager.handleParticipantAction(action, socketId)
      );
    }
  }

  handleSpotlightRemoved() {
    this.videoLayout.spotlightedParticipant = null;
    this.renderParticipants();
    if (this.participantManager.participantsPanelOpen) {
      this.participantManager.renderParticipantsList(
        (action, socketId) => this.participantManager.handleParticipantAction(action, socketId)
      );
    }
  }

  toggleView() {
    this.videoLayout.toggleView();
    this.renderParticipants();
  }

  async toggleMic(button) {
    const isActive = button.getAttribute('data-active') === 'true';
    button.setAttribute('data-active', !isActive);

    const icon = button.querySelector('i');
    icon.className = isActive ? 'fas fa-microphone-slash' : 'fas fa-microphone';

    await this.webrtc.toggleAudio(!isActive);
    this.socket.emit('toggle-mic', { isMuted: isActive });
  }

  async toggleCamera(button) {
    const isActive = button.getAttribute('data-active') === 'true';
    button.setAttribute('data-active', !isActive);

    const icon = button.querySelector('i');
    icon.className = isActive ? 'fas fa-video-slash' : 'fas fa-video';

    await this.webrtc.toggleVideo(!isActive);
    this.socket.emit('toggle-camera', { isCameraOff: isActive });
  }

  async toggleScreenShare(button) {
    const isActive = button.getAttribute('data-active') === 'true';

    if (isActive) {
      await this.webrtc.stopScreenShare();
      button.setAttribute('data-active', 'false');
      const icon = button.querySelector('i');
      if (icon) {
        icon.className = 'fas fa-desktop';
      }
      this.socket.emit('stop-screen-share');
      this.meetingDetails.showToast('Screen sharing stopped', 'info');
    } else {
      try {
        await this.webrtc.startScreenShare();
        button.setAttribute('data-active', 'true');
        const icon = button.querySelector('i');
        if (icon) {
          icon.className = 'fas fa-stop';
        }
        this.socket.emit('start-screen-share', {
          streamId: 'screen',
          hasComputerAudio: true
        });
        this.meetingDetails.showToast('Screen sharing started', 'success');
      } catch (error) {
        console.error('Failed to start screen share:', error);
        this.meetingDetails.showToast('Failed to start screen sharing', 'error');
      }
    }
  }

  endMeeting() {
    this.showMeetingEndOptions((endForEveryone) => {
      const currentMeetingTitleEl = document.querySelector('.meeting-title, #meetingTitle');
      const finalMeetingName = currentMeetingTitleEl ?
        currentMeetingTitleEl.textContent.trim() :
        this.meetingDetails.meetingName;

      if (finalMeetingName && finalMeetingName !== this.meetingDetails.meetingName) {
        this.meetingDetails.meetingName = finalMeetingName;
        console.log('Final meeting name synchronized:', this.meetingDetails.meetingName);
      }

      if (endForEveryone) {
        console.log('Ending meeting for everyone with final name:', this.meetingDetails.meetingName);

        if (this.socket && this.meetingId && this.meetingDetails.userId) {
          this.socket.emit('meeting-ended', {
            meetingId: this.meetingId,
            meetingName: this.meetingDetails.meetingName,
            userId: this.meetingDetails.userId,
            startTime: this.meetingDetails.meetingStartTime,
            endTime: new Date()
          });
        }

        this.socket.emit('end-meeting-for-all', {
          meetingId: this.meetingId,
          reason: 'host-ended'
        });

        this.meetingDetails.showToast('Meeting ended for everyone', 'info');
      } else {
        console.log('Host leaving meeting (others can continue)');

        if (this.socket) {
          this.socket.emit('host-leave-meeting', {
            meetingId: this.meetingId,
            userId: this.meetingDetails.userId
          });
        }

        this.meetingDetails.showToast('You left the meeting', 'info');
      }

      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 500);
    });
  }

  showMeetingEndOptions(callback) {
    const existingModal = document.getElementById('meeting-end-modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'meeting-end-modal-overlay';
    overlay.className = 'meeting-end-modal-overlay';

    overlay.innerHTML = `
      <div class="meeting-end-modal-container">
        <div class="meeting-end-modal-card">
          <div class="meeting-end-bg-gradient"></div>
          <div class="meeting-end-header-section">
            <div class="meeting-end-warning-circle">
              <div class="meeting-end-warning-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
            </div>
            <h2 class="meeting-end-main-title">Leave Meeting?</h2>
            <p class="meeting-end-main-subtitle">Choose how you want to proceed</p>
          </div>
          <div class="meeting-end-actions-container">
            <button class="meeting-end-action-btn end-everyone-btn" data-action="end-all">
              <div class="meeting-end-btn-glow"></div>
              <div class="meeting-end-btn-content">
                <div class="meeting-end-btn-icon-wrapper end-icon-red">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </div>
                <div class="meeting-end-btn-text">
                  <span class="meeting-end-btn-title">End for Everyone</span>
                  <span class="meeting-end-btn-desc">This will end the meeting for all participants</span>
                </div>
              </div>
            </button>
            <button class="meeting-end-action-btn leave-only-btn" data-action="leave">
              <div class="meeting-end-btn-glow"></div>
              <div class="meeting-end-btn-content">
                <div class="meeting-end-btn-icon-wrapper leave-icon-blue">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                </div>
                <div class="meeting-end-btn-text">
                  <span class="meeting-end-btn-title">Leave Meeting</span>
                  <span class="meeting-end-btn-desc">Others can continue without you</span>
                </div>
              </div>
            </button>
          </div>
          <button class="meeting-end-cancel-button" data-action="cancel">
            <span>Cancel</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const endAllBtn = overlay.querySelector('[data-action="end-all"]');
    const leaveBtn = overlay.querySelector('[data-action="leave"]');
    const cancelBtn = overlay.querySelector('[data-action="cancel"]');

    const closeModalGracefully = () => {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 300);
    };

    endAllBtn.addEventListener('click', () => {
      closeModalGracefully();
      setTimeout(() => callback(true), 150);
    });

    leaveBtn.addEventListener('click', () => {
      closeModalGracefully();
      setTimeout(() => callback(false), 150);
    });

    cancelBtn.addEventListener('click', closeModalGracefully);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModalGracefully();
      }
    });

    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeModalGracefully();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new HostMeeting();
});

window.addEventListener('beforeunload', () => {
  if (window.hostMeetingInstance) {
    if (window.hostMeetingInstance.webrtc.localStream) {
      window.hostMeetingInstance.webrtc.localStream.getTracks().forEach(track => track.stop());
    }
    if (window.hostMeetingInstance.socket) {
      window.hostMeetingInstance.socket.disconnect();
    }
  }
});

class ParticipantManager {
  constructor(socket) {
    this.socket = socket;
    this.participants = new Map();
    this.participantsPanelOpen = false;
    this.searchTerm = '';
  }

  updateParticipants(participants, currentSocketId) {
    const localParticipant = this.participants.get(currentSocketId);
    
    this.participants.clear();
    participants.forEach(p => {
      this.participants.set(p.socketId, p);
    });

    if (localParticipant && !this.participants.has(currentSocketId)) {
      this.participants.set(currentSocketId, localParticipant);
    }
  }

  handleParticipantAction(action, socketId) {
    switch(action) {
      case 'spotlight':
        this.socket.emit('spotlight-participant', { targetSocketId: socketId });
        break;
      case 'remove-spotlight':
        this.socket.emit('remove-spotlight');
        break;
      case 'mute':
        this.socket.emit('mute-participant', { targetSocketId: socketId });
        break;
      case 'make-cohost':
        this.socket.emit('make-cohost', { targetSocketId: socketId });
        break;
      case 'kick':
        const participant = this.participants.get(socketId);
        if (participant && confirm(`Remove ${participant.name} from the meeting?`)) {
          this.socket.emit('kick-participant', { targetSocketId: socketId });
        }
        break;
    }
  }

  updateParticipantAudio(socketId, isMuted) {
    const wrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
    if (wrapper) {
      let audioIndicator = wrapper.querySelector('.audio-indicator');
      if (isMuted && !audioIndicator) {
        audioIndicator = document.createElement('div');
        audioIndicator.className = 'audio-indicator';
        audioIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        wrapper.appendChild(audioIndicator);
      } else if (!isMuted && audioIndicator) {
        audioIndicator.remove();
      }
    }

    const participant = this.participants.get(socketId);
    if (participant) {
      participant.isMuted = isMuted;
    }
  }

  removeParticipantVideo(socketId) {
    const wrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
    if (wrapper) {
      wrapper.style.transition = 'all 0.3s ease';
      wrapper.style.opacity = '0';
      wrapper.style.transform = 'scale(0.8)';
      setTimeout(() => wrapper.remove(), 300);
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
    document.getElementById('participantsPanel').classList.add('open');
    document.getElementById('videoContainer').classList.add('participants-open');
    const chatBar = document.getElementById("chatBar");
    if (chatBar) chatBar.classList.remove("open");
  }

  closeParticipantsPanel() {
    this.participantsPanelOpen = false;
    document.getElementById('participantsPanel').classList.remove('open');
    document.getElementById('videoContainer').classList.remove('participants-open');
  }

  setSearchTerm(term) {
    this.searchTerm = term.toLowerCase();
  }

  renderParticipantsList(actionHandler) {
    const participantsList = document.getElementById('participantsList');
    const participantsPanelCount = document.getElementById('participantsPanelCount');
    
    if (!participantsList) return;
    
    participantsList.innerHTML = '';
    
    const filteredParticipants = Array.from(this.participants.values()).filter(participant => 
      participant.name.toLowerCase().includes(this.searchTerm)
    );

    if (participantsPanelCount) {
      participantsPanelCount.textContent = filteredParticipants.length;
    }

    filteredParticipants.forEach(participant => {
      const participantItem = this.createParticipantItem(participant, actionHandler);
      participantsList.appendChild(participantItem);
    });
  }

  createParticipantItem(participant, actionHandler) {
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
        if (actionHandler) {
          actionHandler(action, participant.socketId);
        }
        dropdown.classList.remove('show');
      });
    });

    return item;
  }

  getParticipantDropdownOptions(participant) {
    let options = [];
    
    if (participant.isSpotlighted) {
      options.push('<button data-action="remove-spotlight"><i class="fas fa-star-half-alt"></i> Remove Spotlight</button>');
    } else {
      options.push('<button data-action="spotlight"><i class="fas fa-star"></i> Spotlight</button>');
    }
    
    if (!participant.isHost) {
      options.push(`<button data-action="mute"><i class="fas fa-microphone-slash"></i> ${participant.isMuted ? 'Unmute' : 'Mute'}</button>`);
      
      if (!participant.isCoHost) {
        options.push('<button data-action="make-cohost"><i class="fas fa-user-shield"></i> Make Co-Host</button>');
        options.push('<button data-action="kick" class="danger"><i class="fas fa-user-times"></i> Remove</button>');
      }
    }
    
    return options.join('');
  }

  updateParticipantCount() {
    const count = this.participants.size;
    const countEl = document.getElementById('participantCount');
    if (countEl) {
      countEl.textContent = count;
    }
  }
}



// Export for use in main meeting file
if (typeof window !== 'undefined') {
  window.ParticipantManager = ParticipantManager;
  window.VideoLayout = VideoLayout;
  window.MeetingDetails = MeetingDetails;
}
