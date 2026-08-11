import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthProvider, useAuth } from './src/context/AuthContext.js';
import { useAppFonts } from './src/theme/fonts.js';
import SearchScreen from './src/screens/SearchScreen.js';
import ResultsScreen from './src/screens/ResultsScreen.js';
import TrackingScreen from './src/screens/TrackingScreen.js';
import HistoryScreen from './src/screens/HistoryScreen.js';
import LoginScreen from './src/screens/LoginScreen.js';
import SignupScreen from './src/screens/SignupScreen.js';
import AuthLandingScreen from './src/screens/AuthLandingScreen.js';

const SearchStack = createNativeStackNavigator();
const HistoryStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function SearchStackScreen() {
  return (
    <SearchStack.Navigator>
      <SearchStack.Screen name="SearchHome" component={SearchScreen} options={{ title: 'Search' }} />
      <SearchStack.Screen name="Results" component={ResultsScreen} options={{ title: 'Results' }} />
    </SearchStack.Navigator>
  );
}

// Only History is gated behind auth — Search/Track stay open so browsing
// never requires an account, but history is naturally tied to a user id.
function HistoryStackScreen() {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <HistoryStack.Navigator>
      {user ? (
        <HistoryStack.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
      ) : (
        <>
          <HistoryStack.Screen name="AuthLanding" component={AuthLandingScreen} options={{ title: 'History' }} />
          <HistoryStack.Screen name="Login" component={LoginScreen} options={{ title: 'Log in' }} />
          <HistoryStack.Screen name="Signup" component={SignupScreen} options={{ title: 'Sign up' }} />
        </>
      )}
    </HistoryStack.Navigator>
  );
}

function RootTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Search" component={SearchStackScreen} />
      <Tab.Screen name="Track" component={TrackingScreen} />
      <Tab.Screen name="HistoryTab" component={HistoryStackScreen} options={{ title: 'History' }} />
    </Tab.Navigator>
  );
}

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded] = useAppFonts();

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <RootTabs />
          <StatusBar style="auto" />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
