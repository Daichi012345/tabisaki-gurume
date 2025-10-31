import React from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { AuthProvider, useAuth } from './utils/auth';
import MapScreen from './front/MapScreen';
import AuthScreen from './front/AuthScreen';
import RecommendationRankingScreen from './front/RecommendationRankingScreen';

const Stack = createStackNavigator();

function AppContent(): React.ReactElement {
  const { user, loading } = useAuth();

  if (loading) {
    // ローディング画面（必要に応じて作成）
    return <SafeAreaView style={{ flex: 1 }} />;
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Map"
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen 
          name="Map" 
          component={MapScreen} 
        />
        <Stack.Screen 
          name="RecommendationRanking" 
          component={RecommendationRankingScreen}
          options={{
            headerShown: true,
            headerTitle: 'おすすめ＆ランキング',
            headerStyle: {
              backgroundColor: '#f5f5f5',
            },
            headerTintColor: '#333',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App(): React.ReactElement {
  return (
    <AuthProvider>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1 }} edges={['left','right','bottom']}>
          <AppContent />
        </SafeAreaView>
      </SafeAreaProvider>
    </AuthProvider>
  );
}
