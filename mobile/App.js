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
import ItemDetailsScreen from './src/screens/ItemDetailsScreen.js';
import BookingScreen from './src/screens/BookingScreen.js';
import TripsScreen from './src/screens/TripsScreen.js';
import TripDetailsScreen from './src/screens/TripDetailsScreen.js';
import TrackingScreen from './src/screens/TrackingScreen.js';
import YouScreen from './src/screens/YouScreen.js';
import LoginScreen from './src/screens/LoginScreen.js';
import SignupScreen from './src/screens/SignupScreen.js';
import AuthLandingScreen from './src/screens/AuthLandingScreen.js';

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.bg },
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
      <HomeStack.Screen name="ItemDetails" component={ItemDetailsScreen} options={{ title: 'Details' }} />
      <HomeStack.Screen name="Booking" component={BookingScreen} options={{ title: 'Review & book' }} />
      <HomeStack.Screen name="Login" component={LoginScreen} options={{ title: 'Log in' }} />
      <HomeStack.Screen name="Signup" component={SignupScreen} options={{ title: 'Sign up' }} />
    </HomeStack.Navigator>
  );
}

// Each nested screen has a distinct name from its parent tab.
function makeGatedStackScreen(Stack, ScreenComponent, screenName, authParams, DetailsComponent) {
  return function GatedStackScreen() {
    const { user, loading } = useAuth();
    if (loading) return null;

    return (
      <Stack.Navigator screenOptions={stackScreenOptions}>
        {user ? (
          <>
            <Stack.Screen name={screenName} component={ScreenComponent} options={{ headerShown: false }} />
            {DetailsComponent ? <Stack.Screen name="TripDetails" component={DetailsComponent} options={{ title: 'Your trip' }} /> : null}
          </>
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
const TripsStackScreen = makeGatedStackScreen(TripsStack, TripsScreen, 'ProtectedTrips', {
  heading: 'Sign in to see your trips',
  subheading: 'Your confirmed sandbox flight bookings are saved to your account here.',
}, TripDetailsScreen);

const YouStack = createNativeStackNavigator();
const YouStackScreen = makeGatedStackScreen(YouStack, YouScreen, 'Profile', {
  heading: 'Sign in to set your limits',
  subheading: 'Save your preferred autonomy limits on this device. They are not connected to trip recovery yet.',
});

const TrackStack = createNativeStackNavigator();
const TrackStackScreen = makeGatedStackScreen(TrackStack, TrackingScreen, 'FlightTracking', {
  heading: 'Sign in to track your trips',
  subheading: 'Check your Duffel bookings and airline-reported schedule changes.',
});

const TAB_ICONS = {
  HomeTab: ['home', 'home-outline'],
  Trips: ['git-network', 'git-network-outline'],
  Track: ['locate', 'locate-outline'],
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
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.divider,
            borderTopWidth: 1,
            height: 66,
            paddingTop: 6,
            paddingBottom: 4,
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarIcon: ({ focused, size }) => {
          const [filled, outline] = TAB_ICONS[route.name];
          return <Ionicons name={focused ? filled : outline} size={size} color={focused ? colors.accent700 : colors.textMuted} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeStackScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Trips" component={TripsStackScreen} />
      <Tab.Screen name="Track" component={TrackStackScreen} />
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
