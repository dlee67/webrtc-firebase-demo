import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
// RTCPeerConnection behaves like a "pipe"
// In order to transmit any data using WebRTC, the data you want to transmit must reside in this pipe.
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

// 1. Setup media sources
// Upon clicking this button, I am now readying myself to receive any peer connection.
webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // An event listener that pulls tracks from remote stream, add to video stream.
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/ontrack
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };


  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// Create an offer
// WebRTC peers establishes connections via offer.
// When an offer is created, it will just seat in the STUN server until someone "answers" it.
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  // Will persist the necessary info for the connection.
  // callDoc specifically holds the offers.
  const callDoc = firestore.collection('calls').doc();

  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  // Kicks off as soon as the setLocalDescription() is called.
  pc.onicecandidate = (event) => {
    console.log('Offerer icecandidate')
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  // Offer contains the info of the peer that wishes to establish (calling) a connection.
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createOffer
  const offerDescription = await pc.createOffer();
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/setLocalDescription
  // Like, "what is my IP?"
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  // To create/overwrite a single document
  // https://firebase.google.com/docs/firestore/manage-data/add-data
  // Contents inside the callDoc that will be grabbed by the "answering" candidate.
  await callDoc.set({ offer });

  // Listen for remote answer
  // Only instance when the callDoc document is changed is when the "answerer" uploads their answer.
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/setRemoteDescription
      // Your peer's answer.
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  // This works because Firebase is a realtime database;
  // meaning, as soon as a new value is added to the answer candidate, 
  // the listener below kicks off and we add that specfic candidate to the RTCPeerConnection.
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
// If there is an "offer" seating in the STUN server, "answering" it will establish the connection.
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    console.log('Answerer icecandidate')
    // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnectionIceEvent/candidate
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/setRemoteDescription
  // Your offerer's offer.
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/setLocalDescription
  // Like, "what is my IP?"
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  // This same exact answer object is being used in the above block of code for "call."
  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};
