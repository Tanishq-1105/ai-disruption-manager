import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from './src/context/AuthContext.js';
import { useAppFonts } from './src/theme/fonts.js';
import { colors, typography } from './src/theme/index.js';
import HomeScreen from './src/screens/HomeScreen.js';
import SearchScreen from './src/screens/SearchScreen.js';
import ResultsScreen from './src/screens/ResultsScreen.js';
import TripsScreen from './src/screens/TripsScreen.js';
import TrackingScreen from './src/screens/TrackingScreen.js';
import HistoryScreen from './src/screens/HistoryScreen.js';
import YouScreen from './src/screens/YouScreen.js';
import LoginScreen from './src/screens/LoginScreen.js';
import SignupScreen from './src/screens/SignupScreen.js';
import AuthLandingScreen from './src/screens/AuthLandingScreen.js';

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerShadowVisible: false,
  headerTintColor: colors.accent700,
  headerTitleStyle: { ...typography.headingMedium, fontSize: 17, color: colors.text },
};

// Search/Results are public per the deferred-auth rule (browsing never
// requires an account), so Home's stack carries no auth gate.
const HomeStack = createNativeStackNavigator();
function HomeStackScreen() {
  return (
    <HomeStack.Navigator screenOptions={stackScreenOptions}>
      <HomeStack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <HomeStack.Screen name="SearchHome" component={SearchScreen} options={{ title: 'Search' }} />
      <HomeStack.Screen name="Results" component={ResultsScreen} options={{ title: 'Results' }} />
    </HomeStack.Navigator>
  );
}

// Trips, History, and You all sit behind the same auth gate — signed-out
// users land on AuthLandingScreen (with tab-specific copy) instead of three
// near-duplicate gated stacks.
function makeGatedStackScreen(Stack, ScreenComponent, screenName, authParams) {
  return function GatedStackScreen() {
    const { user, loading } = useAuth();
    if (loading) return null;

    return (
      <Stack.Navigator screenOptions={stackScreenOptions}>
        {user ? (
          <Stack.Screen name={screenName} component={ScreenComponent} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen
              name="AuthLanding"
              component={AuthLandingScreen}
              initialParams={authParams}
              options={{ headerShown: false }}
            />
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Log in' }} />
            <Stack.Screen name="Signup" component={SignupScreen} options={{ title: 'Sign up' }} />
          </>
        )}
      </Stack.Navigator>
    );
  };
}

const TripsStack = createNativeStackNavigator();
const TripsStackScreen = makeGatedStackScreen(TripsStack, TripsScreen, 'Trips', {
  heading: 'Sign in to see your trips',
  subheading: 'Trips you book through TripShield — and the protection watching them — show up here.',
});

const HistoryStack = createNativeStackNavigator();
const HistoryStackScreen = makeGatedStackScreen(HistoryStack, HistoryScreen, 'History', {
  heading: 'Sign in to see your history',
  subheading: 'Your past flight, hotel, and cab searches show up here once you’re signed in.',
});

const YouStack = createNativeStackNavigator();
const YouStackScreen = makeGatedStackScreen(YouStack, YouScreen, 'You', {
  heading: 'Sign in to set your limits',
  subheading: 'Autonomy limits control what the agent may do without asking you first.',
});

const TAB_ICONS = {
  Home: ['home', 'home-outline'],
  Trips: ['git-network', 'git-network-outline'],
  Track: ['locate', 'locate-outline'],
  HistoryTab: ['time', 'time-outline'],
  You: ['person-circle', 'person-circle-outline'],
};

const Tab = createBottomTabNavigator();

function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent700,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.divider },
        tabBarIcon: ({ focused, size }) => {
          const [filled, outline] = TAB_ICONS[route.name];
          return <Ionicons name={focused ? filled : outline} size={size} color={focused ? colors.accent700 : colors.textMuted} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeStackScreen} />
      <Tab.Screen name="Trips" component={TripsStackScreen} />
      <Tab.Screen name="Track" component={TrackingScreen} />
      <Tab.Screen name="HistoryTab" component={HistoryStackScreen} options={{ title: 'History' }} />
      <Tab.Screen name="You" component={YouStackScreen} />
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
