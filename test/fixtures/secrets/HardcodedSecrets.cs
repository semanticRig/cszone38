public class HardcodedSecrets
{
    private const string JwtSigningKey = "A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6S7t8U9v0W1x2Y3z4A5b6C7d8E9f0G1h2";
    private const string ServiceToken = "ghp_z4V8nQ2mLp7sT1xK9cR5wY3bF6dH0jN8pQ4rS2t";

    public string Read()
    {
        return JwtSigningKey + ServiceToken;
    }
}