import { getMessaging, getToken } from "firebase/messaging";
import { app, dbInstance } from "./firebaseConfig";
import { collection, doc, setDoc } from "firebase/firestore";

const VAPID_KEY = "BNuXxMUrJjAZIkgipNA7DZN2tGGktdrKyjQgdmYpLpJpl4ajzGtBTq5VNv5APokhyrlZVCMXco4unAEYXBLJ33E";

export async function requestNotificationPermission() {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notification permission granted.');
            await saveTokenToDatabase();
            return true;
        } else {
            console.log('Unable to get permission to notify.');
            return false;
        }
    } catch (error) {
        console.error('Error requesting notification permission:', error);
        return false;
    }
}

export async function saveTokenToDatabase() {
    try {
        const messaging = getMessaging(app);

        // Registrar o token do dispositivo
        const currentToken = await getToken(messaging, {
            vapidKey: VAPID_KEY
        });

        if (currentToken) {
            console.log('Token received:', currentToken);

            // Salvar no Firestore
            // Usamos o token como ID do documento para evitar duplicidade
            await setDoc(doc(dbInstance, "pushTokens", currentToken), {
                token: currentToken,
                updatedAt: new Date().toISOString(),
                userAgent: navigator.userAgent
            });

            return currentToken;
        } else {
            console.log('No registration token available. Request permission to generate one.');
            return null;
        }
    } catch (error) {
        console.error('An error occurred while retrieving token:', error);
        return null;
    }
}
