class VideoLayoutManager {
    constructor(webrtcManager, socket) {
        this.webrtc = webrtcManager;
        this.socket = socket;
        this.currentView = 'sidebar';
        this.currentSet = 0;
        this.videosPerSet = 15;
        this.totalSets = 0;
        this.spotlightedParticipant = null;
        this.pinnedParticipant = null;
        this.participants = new Map();
    }

    setParticipants(participants) {
        this.participants = participants;
    }

    setSpotlightedParticipant(socketId) {
        this.spotlightedParticipant = socketId;
    }

    setPinnedParticipant(socketId) {
        this.pinnedParticipant = socketId;
    }

    calculateGridPagination() {
        const totalParticipants = this.participants.size;
        this.totalSets = Math.ceil(totalParticipants / this.videosPerSet);

        if (this.currentSet >= this.totalSets) {
            this.currentSet = Math.max(0, this.totalSets - 1);
        }
    }

    getCurrentSetParticipants() {
        const participantArray = Array.from(this.participants.values());
        const startIndex = this.currentSet * this.videosPerSet;
        const endIndex = startIndex + this.videosPerSet;
        return participantArray.slice(startIndex, endIndex);
    }

    updateGridSizeClass() {
        const videoContainer = document.getElementById('videoContainer');
        const participantCount = this.participants.size;

        videoContainer.classList.remove(
            'participants-2', 'participants-3', 'participants-4',
            'participants-5', 'participants-6', 'participants-7',
            'participants-8', 'participants-9', 'participants-10',
            'participants-11', 'participants-12', 'participants-13',
            'participants-14', 'participants-15'
        );

        if (participantCount >= 2 && participantCount <= 15) {
            videoContainer.classList.add(`participants-${participantCount}`);
        }
    }

    createGridNavigation() {
        const videoContainer = document.getElementById('videoContainer');
        let navigation = videoContainer.querySelector('.grid-navigation');

        if (!navigation) {
            navigation = document.createElement('div');
            navigation.className = 'grid-navigation';
            videoContainer.appendChild(navigation);
        }

        const startParticipant = this.currentSet * this.videosPerSet + 1;
        const endParticipant = Math.min((this.currentSet + 1) * this.videosPerSet, this.participants.size);

        navigation.innerHTML = `
            <button class="grid-nav-btn" id="prevSetBtn" ${this.currentSet === 0 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i>
                Previous
            </button>
            <div class="grid-nav-info">
                ${startParticipant}-${endParticipant} of ${this.participants.size}
            </div>
            <button class="grid-nav-btn" id="nextSetBtn" ${this.currentSet >= this.totalSets - 1 ? 'disabled' : ''}>
                Next
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        const prevBtn = navigation.querySelector('#prevSetBtn');
        const nextBtn = navigation.querySelector('#nextSetBtn');

        prevBtn.addEventListener('click', () => {
            if (this.currentSet > 0) {
                this.currentSet--;
                this.renderParticipants();
            }
        });

        nextBtn.addEventListener('click', () => {
            if (this.currentSet < this.totalSets - 1) {
                this.currentSet++;
                this.renderParticipants();
            }
        });
    }

    toggleView() {
        const videoContainer = document.getElementById('videoContainer');
        const viewToggleIcon = document.getElementById('viewToggleIcon');
        const viewToggleText = document.getElementById('viewToggleText');

        if (this.currentView === 'sidebar') {
            this.currentView = 'grid';
            this.currentSet = 0;
            videoContainer.classList.remove('sidebar-view');
            videoContainer.classList.add('grid-view');
            if (viewToggleIcon) viewToggleIcon.className = 'fas fa-columns';
            if (viewToggleText) viewToggleText.textContent = 'Sidebar View';
        } else {
            this.currentView = 'sidebar';
            videoContainer.classList.remove('grid-view');
            videoContainer.classList.add('sidebar-view');
            if (viewToggleIcon) viewToggleIcon.className = 'fas fa-th';
            if (viewToggleText) viewToggleText.textContent = 'Grid View';

            const navigation = videoContainer.querySelector('.grid-navigation');
            if (navigation) {
                navigation.remove();
            }
        }
    }

    createVideoWrapper(participant) {
        const wrapper = document.createElement('div');
        wrapper.className = 'video-wrapper';
        wrapper.dataset.socketId = participant.socketId;

        if (participant.isSpotlighted || this.pinnedParticipant === participant.socketId) {
            wrapper.setAttribute('data-main-video', 'true');
        }

        const dropdownOptions = this.getDropdownOptions(participant);

        wrapper.innerHTML = `
            <video class="video-frame" autoplay playsinline ${participant.socketId === this.socket.id ? 'muted' : ''}></video>
            <div class="video-controls">
                <button class="menu-dots">⋮</button>
                <div class="dropdown-menu">
                    ${dropdownOptions}
                </div>
            </div>
            <div style="color: #f1f5f9" class="participant-name">${participant.name}${participant.isHost ? ' (Host)' : ''}${participant.isCoHost ? ' (Co-Host)' : ''}</div>
            ${participant.isSpotlighted ? '<div style="display: none" class="spotlight-badge"><i class="fas fa-star"></i></div>' : ''}
            ${this.pinnedParticipant === participant.socketId ? '<div class="pin-badge"><i class="fas fa-thumbtack"></i></div>' : ''}
            ${participant.isMuted ? '<div class="audio-indicator"><i class="fas fa-microphone-slash"></i></div>' : ''}
        `;

        return wrapper;
    }

    getDropdownOptions(participant) {
        let options = [];

        if (this.pinnedParticipant === participant.socketId) {
            options.push('<button data-action="unpin">Unpin</button>');
        } else {
            options.push('<button data-action="pin">Pin</button>');
        }

        const isCoHost = window.hostMeetingInstance?.isCoHost || false;

        if (isCoHost && !participant.isHost) {
            if (participant.isSpotlighted) {
                options.push('<button data-action="remove-spotlight">Remove Spotlight</button>');
            } else {
                options.push('<button data-action="spotlight">Spotlight</button>');
            }

            options.push(`<button data-action="mute">${participant.isMuted ? 'Unmute' : 'Mute'} Participant</button>`);
        }

        return options.join('');
    }

    renderParticipants(renderCallback) {
        const mainVideoSection = document.getElementById('mainVideoSection');
        const secondaryVideosSection = document.getElementById('secondaryVideosSection');

        if (!mainVideoSection || !secondaryVideosSection) return;

        mainVideoSection.innerHTML = '';
        secondaryVideosSection.innerHTML = '';

        if (this.currentView === 'grid') {
            this.calculateGridPagination();
            this.updateGridSizeClass();

            const currentSetParticipants = this.getCurrentSetParticipants();

            currentSetParticipants.forEach(participant => {
                const videoWrapper = this.createVideoWrapper(participant);
                secondaryVideosSection.appendChild(videoWrapper);
            });

            if (this.totalSets > 1) {
                this.createGridNavigation();
            }
        } else {
            const participantArray = Array.from(this.participants.values());

            participantArray.forEach(participant => {
                const videoWrapper = this.createVideoWrapper(participant);

                const shouldBeMain = (this.spotlightedParticipant === participant.socketId ||
                                    this.pinnedParticipant === participant.socketId);

                if (shouldBeMain && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                    videoWrapper.classList.add('main-video');
                    videoWrapper.setAttribute('data-main-video', 'true');
                    secondaryVideosSection.appendChild(videoWrapper);
                } else if (shouldBeMain && /Windows|Macintosh|Linux/i.test(navigator.userAgent)) {
                    videoWrapper.classList.add('main-video');
                    videoWrapper.setAttribute('data-main-video', 'true');
                    mainVideoSection.appendChild(videoWrapper);
                } else {
                    secondaryVideosSection.appendChild(videoWrapper);
                }
            });
        }

        if (renderCallback) {
            renderCallback();
        }
    }

    attachStreamsToVideos(localStream, isScreenSharing, screenStream) {
        const videoWrappers = document.querySelectorAll('.video-wrapper[data-socket-id]');

        videoWrappers.forEach(wrapper => {
            const socketId = wrapper.dataset.socketId;
            const video = wrapper.querySelector('.video-frame');

            if (!video) return;

            if (socketId === this.socket.id) {
                if (isScreenSharing && screenStream) {
                    video.srcObject = screenStream;
                } else if (localStream) {
                    video.srcObject = localStream;
                }
                video.play().catch(e => console.error('Error playing local video:', e));
            } else {
                const participant = this.participants.get(socketId);
                if (participant && participant.isCameraOff) {
                    video.style.display = 'none';
                } else {
                    const remoteStream = this.webrtc.getRemoteStream(socketId);
                    if (remoteStream && video.srcObject !== remoteStream) {
                        video.srcObject = remoteStream;
                        video.play().catch(e => console.error('Error playing remote video:', e));
                    }
                }
            }
        });
    }

    updateRemoteVideoDisplay(socketId, isCameraOff) {
        const wrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
        if (!wrapper) return;

        const video = wrapper.querySelector('.video-frame');
        if (!video) return;

        if (isCameraOff) {
            video.style.display = 'none';
            video.style.visibility = 'hidden';
            video.style.width = '0';
            video.style.height = '0';
            video.style.opacity = '0';
        } else {
            video.style.display = '';
            video.style.visibility = '';
            video.style.width = '';
            video.style.height = '';
            video.style.opacity = '';

            const remoteStream = this.webrtc.getRemoteStream(socketId);
            if (remoteStream) {
                video.srcObject = remoteStream;
                video.play().catch(e => console.error('Error playing video after toggle:', e));
            }
        }
    }

    updateParticipantAudioIndicator(socketId, isMuted) {
        const wrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
        if (!wrapper) return;

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

    removeParticipantVideo(socketId) {
        const wrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
        if (wrapper) {
            wrapper.style.transition = 'all 0.3s ease';
            wrapper.style.opacity = '0';
            wrapper.style.transform = 'scale(0.8)';
            setTimeout(() => wrapper.remove(), 300);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoLayoutManager;
}
