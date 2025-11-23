class VideoLayout {
  constructor() {
    this.currentView = 'sidebar';
    this.currentGridSet = 0;
    this.maxParticipantsPerSet = 15;
    this.currentSidebarSet = 0;
    this.maxSidebarParticipants = 5;
    this.spotlightedParticipant = null;
  }

  renderParticipants(participants, webrtc) {
    const mainVideoSection = document.getElementById('mainVideoSection');
    const secondaryVideosSection = document.getElementById('secondaryVideosSection');

    mainVideoSection.innerHTML = '';
    secondaryVideosSection.innerHTML = '';

    const participantArray = Array.from(participants.values());

    if (this.currentView === 'grid') {
      const startIndex = this.currentGridSet * this.maxParticipantsPerSet;
      const endIndex = Math.min(startIndex + this.maxParticipantsPerSet, participantArray.length);
      const currentSetParticipants = participantArray.slice(startIndex, endIndex);

      this.renderGridLayout(currentSetParticipants, secondaryVideosSection, webrtc);
      this.updateGridNavigation(participantArray.length);
    } else {
      const sidebarParticipants = participantArray.filter(p => !p.isSpotlighted || this.currentView !== 'sidebar');

      const startIndex = this.currentSidebarSet * this.maxSidebarParticipants;
      const endIndex = Math.min(startIndex + this.maxSidebarParticipants, sidebarParticipants.length);
      const currentSetSidebarParticipants = sidebarParticipants.slice(startIndex, endIndex);

      participantArray.forEach((participant) => {
        const videoWrapper = this.createVideoWrapper(participant, webrtc);

        if (participant.isSpotlighted && this.currentView === 'sidebar') {
          videoWrapper.classList.add('main-video');
          videoWrapper.setAttribute('data-main-video', 'true');
          mainVideoSection.appendChild(videoWrapper);
        } else if (currentSetSidebarParticipants.includes(participant)) {
          secondaryVideosSection.appendChild(videoWrapper);
        }
      });

      this.updateSidebarNavigation(sidebarParticipants.length);
    }
  }

  renderGridLayout(participants, container, webrtc) {
    const participantCount = participants.length;

    if (participantCount === 15 || participantCount === 12 || participantCount === 13 || participantCount === 14 || participantCount === 11 || participantCount === 2 || participantCount === 7 || participantCount === 8 || participantCount === 9 || (participantCount >= 3 && participantCount <= 6)) {
      container.className = 'secondary-videos-section custom-layout';
      container.classList.add(`participants-${participantCount}`);
      this.renderCustomGridLayout(participants, container, participantCount, webrtc);
    } else {
      container.className = 'secondary-videos-section standard-grid';
      this.renderStandardGridLayout(participants, container, participantCount, webrtc);
    }
  }

  renderCustomGridLayout(participants, container, count, webrtc) {
    let rows = [];

    switch (count) {
      case 2:
        participants.forEach(participant => {
          const videoWrapper = this.createVideoWrapper(participant, webrtc);
          container.appendChild(videoWrapper);
        });
        return;
      case 3:
        rows = [participants.slice(0, 2), participants.slice(2, 3)];
        break;
      case 4:
        rows = [participants.slice(0, 2), participants.slice(2, 4)];
        break;
      case 5:
        rows = [participants.slice(0, 3), participants.slice(3, 5)];
        break;
      case 6:
        rows = [participants.slice(0, 3), participants.slice(3, 6)];
        break;
      case 7:
        rows = [participants.slice(0, 4), participants.slice(4, 7)];
        break;
      case 8:
        rows = [participants.slice(0, 4), participants.slice(4, 8)];
        break;
      case 9:
        rows = [participants.slice(0, 5), participants.slice(5, 9)];
        break;
      case 11:
        rows = [participants.slice(0, 4), participants.slice(4, 8), participants.slice(8, 11)];
        break;
      case 12:
        rows = [participants.slice(0, 4), participants.slice(4, 8), participants.slice(8, 12)];
        break;
      case 13:
        rows = [participants.slice(0, 5), participants.slice(5, 10), participants.slice(10, 13)];
        break;
      case 14:
        rows = [participants.slice(0, 5), participants.slice(5, 10), participants.slice(10, 14)];
        break;

      case 15:
    rows = [
        participants.slice(0, 5),   // Row 1: participants 0–4
        participants.slice(5, 10),  // Row 2: participants 5–9
        participants.slice(10, 15)  // Row 3: participants 10–14
    ];
    break;

      
    }

    rows.forEach(rowParticipants => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'grid-row';

      rowParticipants.forEach(participant => {
        const videoWrapper = this.createVideoWrapper(participant, webrtc);
        rowDiv.appendChild(videoWrapper);
      });

      container.appendChild(rowDiv);
    });
  }

  renderStandardGridLayout(participants, container, count, webrtc) {
    let columns = 5;
    let maxWidth = '280px';

    if (count === 1) {
      columns = 1;
      maxWidth = '400px';
    } else if (count === 2) {
      columns = 2;
      maxWidth = '350px';
    } else if (count <= 5) {
      columns = count;
      maxWidth = '320px';
    } else if (count <= 10) {
      columns = 5;
      maxWidth = '280px';
    } else if (count <= 15) {
      columns = 5;
      maxWidth = '250px';
    } else if (count <= 20) {
      columns = 5;
      maxWidth = '220px';
    } else {
      columns = 5;
      maxWidth = '200px';
    }

    container.style.gridTemplateColumns = `repeat(${columns}, minmax(180px, ${maxWidth}))`;
    container.style.gap = count > 20 ? '12px' : '16px';

    participants.forEach(participant => {
      const videoWrapper = this.createVideoWrapper(participant, webrtc);
      container.appendChild(videoWrapper);
    });
  }

  createVideoWrapper(participant, webrtc) {
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.dataset.socketId = participant.socketId;

    if (participant.isSpotlighted) {
      wrapper.setAttribute('data-main-video', 'true');
    }

    const dropdownOptions = this.getDropdownOptions(participant);

    wrapper.innerHTML = `
      <video class="video-frame" autoplay playsinline ${participant.socketId === webrtc.socket.id ? 'muted' : ''}></video>
      <div class="video-controls">
        <button class="menu-dots">⋮</button>
        <div class="dropdown-menu">
          ${dropdownOptions}
        </div>
      </div>
      <div class="participant-name">${participant.name}${participant.isHost ? ' (Host)' : ''}${participant.isCoHost ? ' (Co-Host)' : ''}</div>
      ${participant.isSpotlighted ? '<div class="spotlight-badge"><i class="fas fa-star"></i></div>' : ''}
      ${participant.isMuted ? '<div class="audio-indicator"><i class="fas fa-microphone-slash"></i></div>' : ''}
    `;

    setTimeout(() => {
      const video = wrapper.querySelector('.video-frame');
      if (participant.socketId === webrtc.socket.id) {
        if (webrtc.isScreenSharing && webrtc.screenStream) {
          video.srcObject = webrtc.screenStream;
        } else if (webrtc.localStream) {
          video.srcObject = webrtc.localStream;
        }
        video.play().catch(e => console.error('Error playing local video:', e));
      } else {
        const remoteStream = webrtc.getRemoteStream(participant.socketId);
        if (remoteStream) {
          video.srcObject = remoteStream;
          video.play().catch(e => console.error('Error playing remote video:', e));
        }
      }
    }, 100);

    return wrapper;
  }

  getDropdownOptions(participant) {
    let options = [];

    if (participant.isSpotlighted) {
      options.push('<button data-action="remove-spotlight">Remove Spotlight</button>');
    } else {
      options.push('<button data-action="spotlight">Spotlight</button>');
    }

    if (!participant.isHost) {
      options.push(`<button data-action="mute">${participant.isMuted ? 'Unmute' : 'Mute'} Participant</button>`);

      if (!participant.isCoHost) {
        options.push('<button data-action="make-cohost">Make Co-Host</button>');
        options.push('<button data-action="kick">Remove from Meeting</button>');
      }
    }

    return options.join('');
  }

  toggleView() {
    const videoContainer = document.getElementById('videoContainer');
    const viewToggleIcon = document.getElementById('viewToggleIcon');
    const viewToggleText = document.getElementById('viewToggleText');
    const sidebarNavigation = document.getElementById('sidebarNavigation');
    const gridNavigation = document.getElementById('gridNavigation');
    if (this.currentView === 'sidebar') {
      this.currentView = 'grid';
      this.currentGridSet = 0;
      this.currentSidebarSet = 0;
      videoContainer.classList.remove('sidebar-view');
      videoContainer.classList.add('grid-view');
      viewToggleIcon.className = 'fas fa-columns';
      viewToggleText.textContent = 'Sidebar View';
      
      const container = document.getElementById('secondaryVideosSection');
      sidebarNavigation.style.display = 'none';

  if (container) {
    container.style.overflow = 'hidden';

    // Loop through all child elements and disable their scrollbars too
    const allChildren = container.querySelectorAll('*');
    allChildren.forEach(el => {
      el.style.overflow = 'hidden';
      el.style.scrollbarWidth = 'none'; // Firefox
      el.style.overscrollBehavior = 'none';

      // Hide scrollbar for WebKit browsers
      el.style.setProperty('::-webkit-scrollbar', 'display: none');
    });
  }
    } else {
      this.currentView = 'sidebar';
      this.currentSidebarSet = 0;
      gridNavigation.style.display = 'none';
      videoContainer.classList.remove('grid-view');
      videoContainer.classList.add('sidebar-view');
      viewToggleIcon.className = 'fas fa-th';
      viewToggleText.textContent = 'Grid View';

      const container = document.getElementById('secondaryVideosSection');

if (container) {
  container.style.overflow = 'auto';  // allow scrolling

  // Loop through all child elements and ENABLE their scrollbars
  const allChildren = container.querySelectorAll('*');
  allChildren.forEach(el => {
    el.style.overflow = 'auto';          // allow scroll
    el.style.scrollbarWidth = 'auto';    // Firefox: show scrollbar
    el.style.overscrollBehavior = 'auto';

    // Show scrollbar for WebKit browsers
    el.style.removeProperty('::-webkit-scrollbar'); 
  });
}

    }
  }

  navigateGridSet(direction, totalParticipants) {
    const totalSets = Math.ceil(totalParticipants / this.maxParticipantsPerSet);

    this.currentGridSet += direction;

    if (this.currentGridSet < 0) {
      this.currentGridSet = 0;
    } else if (this.currentGridSet >= totalSets) {
      this.currentGridSet = totalSets - 1;
    }

    this.updateGridNavigation(totalParticipants);
  }

  navigateSidebarSet(direction, sidebarParticipantsCount) {
    const totalSets = Math.ceil(sidebarParticipantsCount / this.maxSidebarParticipants);

    this.currentSidebarSet += direction;

    if (this.currentSidebarSet < 0) {
      this.currentSidebarSet = 0;
    } else if (this.currentSidebarSet >= totalSets) {
      this.currentSidebarSet = totalSets - 1;
    }
  }

  updateGridNavigation(totalParticipants) {
    const totalSets = Math.ceil(totalParticipants / this.maxParticipantsPerSet);
    const gridNavigation = document.getElementById('gridNavigation');
    const prevBtn = document.getElementById('prevSetBtn');
    const nextBtn = document.getElementById('nextSetBtn');
    const currentSetInfo = document.getElementById('currentSetInfo');

    if (this.currentView === 'grid' && totalSets > 1) {
      gridNavigation.style.display = 'flex';
      prevBtn.disabled = this.currentGridSet === 0;
      nextBtn.disabled = this.currentGridSet === totalSets - 1;
      currentSetInfo.textContent = `Set ${this.currentGridSet + 1} of ${totalSets}`;
    } else {
      gridNavigation.style.display = 'none';
    }
  }

  updateSidebarNavigation(sidebarParticipantsCount) {
    const totalSets = Math.ceil(sidebarParticipantsCount / this.maxSidebarParticipants);
    const sidebarNavigation = document.getElementById('sidebarNavigation');
    const prevBtn = document.getElementById('prevSidebarBtn');
    const nextBtn = document.getElementById('nextSidebarBtn');
    const currentSidebarInfo = document.getElementById('currentSidebarInfo');

    if (this.currentView === 'sidebar' && totalSets > 1) {
      sidebarNavigation.style.display = 'flex';
      prevBtn.disabled = this.currentSidebarSet === 0;
      nextBtn.disabled = this.currentSidebarSet === totalSets - 1;
      currentSidebarInfo.textContent = `${this.currentSidebarSet + 1} of ${totalSets}`;
    } else {
      sidebarNavigation.style.display = 'none';
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoLayout;
}
