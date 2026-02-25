import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAVgzqQtq6Vxx6JYGsKmEEYyyTZMIUBDyk",
  authDomain: "project-cef4991b-01a5-4cb4-bd5.firebaseapp.com",
  projectId: "project-cef4991b-01a5-4cb4-bd5",
  storageBucket: "project-cef4991b-01a5-4cb4-bd5.firebasestorage.app",
  messagingSenderId: "958084567957",
  appId: "1:958084567957:web:f3d7097c9fd1c6088c5c9c",
  measurementId: "G-GKWZHQL33V"
};

// Inicializa o Firebase
export const app = initializeApp(firebaseConfig);

// Inicializa o Firestore (Banco de Dados)
export const dbInstance = getFirestore(app);

// Inicializa o Auth
export const authInstance = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Inicializa o Storage
import { getStorage } from "firebase/storage";
export const storageInstance = getStorage(app);