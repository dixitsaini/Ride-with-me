import React, {useState} from 'react';
import { SafeAreaView, View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';

export default function App() {
  const [name, setName] = useState('');

  const onPressGreet = () => {
    const who = name.trim() || 'friend';
    Alert.alert('Hello', `Hello, ${who}! 👋`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome</Text>
        <Text style={styles.subtitle}>A minimal single-screen React Native app</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter your name"
          value={name}
          onChangeText={setName}
        />

        <View style={styles.button}>
          <Button title="Greet me" onPress={onPressGreet} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f6ff', alignItems: 'center', justifyContent: 'center' },
  card: { width: '90%', padding: 20, backgroundColor: 'white', borderRadius: 8, shadowColor: '#000', shadowOpacity: 0.05, elevation: 2 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 18 },
  input: { borderColor: '#ddd', borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 12 },
  button: { marginTop: 6 }
});
