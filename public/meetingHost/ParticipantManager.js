class ParticipantManager {
  constructor(socket) {
    this.socket = socket;
    this.participants = new Map();
    this.participantsPanelOpen = false;
    this.searchTerm = '';
  }

  updateParticipants(participants, localSocketId) {
    const localParticipant = this.participants.get(localSocketId);

    this.participants.clear();
    participants.forEach(p => {
      this.participants.set(p.socketId, p);
    });

    if (localParticipant && !this.participants.has(localSocketId)) {
      this.participants.set(localSocketId, localParticipant);
    }

    return this.participants;
  }

  renderParticipantsList(onParticipantAction) {
    const participantsList = document.getElementById('participantsList');
    const participantsPanelCount = document.getElementById('participantsPanelCount');

    if (!participantsList || !participantsPanelCount) return;

    participantsList.innerHTML = '';

    const filteredParticipants = Array.from(this.participants.values()).filter(participant =>
      participant.name.toLowerCase().includes(this.searchTerm)
    );

    participantsPanelCount.textContent = filteredParticipants.length;

    filteredParticipants.forEach(participant => {
      const participantItem = this.createParticipantItem(participant, onParticipantAction);
      participantsList.appendChild(participantItem);
    });
  }

  createParticipantItem(participant, onParticipantAction) {
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
        if (onParticipantAction) {
          onParticipantAction(action, participant.socketId);
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

  handleParticipantAction(action, socketId) {
    const participant = this.participants.get(socketId);

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
        if (participant && confirm(`Remove ${participant.name} from the meeting?`)) {
          this.socket.emit('kick-participant', { targetSocketId: socketId });
        }
        break;
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
    const panel = document.getElementById('participantsPanel');
    const container = document.getElementById('videoContainer');
    if (panel) panel.classList.add('open');
    if (container) container.classList.add('participants-open');

    const chatBar = document.getElementById("chatBar");
    if (chatBar) chatBar.classList.remove("open");
  }

  closeParticipantsPanel() {
    this.participantsPanelOpen = false;
    const panel = document.getElementById('participantsPanel');
    const container = document.getElementById('videoContainer');
    if (panel) panel.classList.remove('open');
    if (container) container.classList.remove('participants-open');
  }

  updateParticipantCount() {
    const count = this.participants.size;
    const countElement = document.getElementById('participantCount');
    if (countElement) {
      countElement.textContent = count;
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

  setSearchTerm(term) {
    this.searchTerm = term.toLowerCase();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParticipantManager;
}
