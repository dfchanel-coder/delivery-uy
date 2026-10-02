import 'package:deliveryuy_core/deliveryuy_core.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// [TokenStore] backed by the platform keystore.
///
/// Android resolves this to an AES-GCM value under a key wrapped by the Android
/// Keystore, so the refresh token is encrypted with a key the operating system
/// does not export and that is discarded when the app is uninstalled. iOS
/// resolves it to a keychain item. Neither backend is implemented here: the
/// plugin owns the platform differences, and the shared package owns the port
/// (ADR-021).
///
/// Only the refresh token is written, under a key namespaced by API origin, so a
/// development build and a production build installed side by side cannot read
/// each other's value.
class SecureTokenStore implements TokenStore {
  /// Creates the store over [storage].
  ///
  /// [storage] is injectable because it is a platform channel: a unit test
  /// cannot drive one, so tests inject an in-memory double instead of pretending
  /// the keystore works in the test VM.
  const SecureTokenStore(this._storage);

  /// Android options, kept at the plugin defaults on purpose.
  ///
  /// Version 11 encrypts unconditionally (AES-GCM for the value, RSA-OAEP key
  /// wrapping in the Android Keystore); older versions needed an opt-in that no
  /// longer exists. `resetOnError` also stays at its default of true: an entry
  /// whose key was lost cannot be decrypted, and the only honest outcome for an
  /// unreadable refresh token is to drop it and ask the user to sign in again.
  static const AndroidOptions _androidOptions = AndroidOptions();

  /// Options for iOS keychain items.
  ///
  /// The value must survive until the user signs out, including across a reboot,
  /// but must not ride along in an unencrypted iCloud or iTunes backup: this
  /// attribute keeps the item out of backup migrations.
  static const IOSOptions _iosOptions = IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
  );

  final FlutterSecureStorage _storage;

  @override
  Future<StoredSession?> read(String apiBaseUrl) async {
    // A store that cannot be read is treated as an empty one: the caller can only
    // fall back to the sign-in form, which is a correct outcome, while throwing
    // here would crash the launch path.
    try {
      final String? refreshToken = await _storage.read(
        key: _key(apiBaseUrl),
        aOptions: _androidOptions,
        iOptions: _iosOptions,
      );

      if (refreshToken == null || refreshToken.isEmpty) {
        return null;
      }

      return StoredSession(refreshToken: refreshToken, apiBaseUrl: apiBaseUrl);
    } on Object {
      return null;
    }
  }

  @override
  Future<void> write(StoredSession session) async {
    await _storage.write(
      key: _key(session.apiBaseUrl),
      value: session.refreshToken,
      aOptions: _androidOptions,
      iOptions: _iosOptions,
    );
  }

  @override
  Future<void> clear(String apiBaseUrl) async {
    await _storage.delete(
      key: _key(apiBaseUrl),
      aOptions: _androidOptions,
      iOptions: _iosOptions,
    );
  }

  /// Storage key for one deployment.
  ///
  /// The origin is part of the key, not of the value: two deployments on one
  /// device are two independent entries rather than one value that whichever app
  /// installed last managed to overwrite.
  static String _key(String apiBaseUrl) => 'deliveryuy.refresh_token.$apiBaseUrl';
}